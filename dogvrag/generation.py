"""Adapters de generación. Un `Generator` recibe mensajes tipo chat y devuelve texto.

La web usa cualquier servidor con API tipo OpenAI (DeepSeek, OpenAI, LM Studio, Ollama, vLLM…).
"""
from __future__ import annotations

import os
import re
from typing import Protocol

Message = dict[str, str]
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


class Generator(Protocol):
    name: str
    available: bool

    def generate(self, messages: list[Message], max_tokens: int = 700, temperature: float = 0.1) -> str: ...


def _clean(text: str) -> str:
    return _THINK_RE.sub("", text or "").strip()


class OpenAICompatGenerator:
    """Cualquier servidor con API tipo OpenAI: LM Studio, Ollama, vLLM, llama.cpp, DeepSeek, OpenAI...

    - LM Studio:  base_url="http://localhost:1234/v1"
    - Ollama:     base_url="http://localhost:11434/v1"
    - DeepSeek:   base_url="https://api.deepseek.com", api_key_env="DEEPSEEK_API_KEY"
    """

    def __init__(self, base_url: str = "http://localhost:1234/v1", model: str | None = None,
                 api_key: str | None = None, api_key_env: str | None = None, timeout: float = 300.0,
                 extra_body: dict | None = None):
        import requests

        self._requests = requests
        self.base_url = base_url.rstrip("/")
        key = api_key or (os.environ.get(api_key_env) if api_key_env else None)
        self._headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})}
        self.timeout = timeout
        self.extra_body = extra_body or {}
        self.model = model
        self.error = ""
        models = self.list_models()
        self.available = not self.error
        if self.available and self.model is None:
            # descarta modelos de embeddings que algunos servidores listan junto a los de chat
            chat = [m for m in models if not re.search(r"embed|rerank|bge|e5", m, re.I)]
            self.model = (chat or models or [None])[0]
            if self.model is None:
                self.available = False
                self.error = f"El servidor {self.base_url} no lista ningún modelo cargado."
        self.name = f"{self.model}@{self.base_url}"

    def list_models(self) -> list[str]:
        try:
            r = self._requests.get(f"{self.base_url}/models", headers=self._headers, timeout=10)
            r.raise_for_status()
            return [m.get("id", "") for m in r.json().get("data", []) if m.get("id")]
        except Exception as exc:  # servidor apagado, URL incorrecta, clave rechazada...
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (401, 403):
                self.error = (f"{self.base_url} ha rechazado la clave (HTTP {status}): revisa la variable de "
                              "entorno con la API key.")
            else:
                self.error = f"No se pudo conectar con {self.base_url}: {exc}"
            return []

    def generate(self, messages: list[Message], max_tokens: int = 700, temperature: float = 0.1) -> str:
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens,
                "temperature": temperature, "stream": False, **self.extra_body}
        r = self._requests.post(f"{self.base_url}/chat/completions", headers=self._headers, json=body,
                                timeout=self.timeout)
        if r.status_code >= 400:
            raise RuntimeError(f"Error {r.status_code} del servidor LLM: {r.text[:400]}")
        return _clean(r.json()["choices"][0]["message"].get("content", ""))


class NullGenerator:
    """Sin LLM: permite usar y comparar el retrieval aunque no haya ningún modelo generativo disponible."""

    name = "sin-LLM"
    available = False

    def __init__(self, reason: str = ""):
        self.error = reason

    def generate(self, messages: list[Message], max_tokens: int = 700, temperature: float = 0.1) -> str:
        return ""


def connect_generator(base_url: str, model: str | None = None, **kwargs) -> Generator:
    """Devuelve un generador OpenAI-compatible o, si no hay servidor, un `NullGenerator` con el motivo."""
    try:
        gen = OpenAICompatGenerator(base_url, model, **kwargs)
    except Exception as exc:
        return NullGenerator(str(exc))
    if not gen.available:
        return NullGenerator(gen.error)
    return gen
