"""Configuración del RAG Lab.

Orden de prioridad (de menor a mayor):
1. Valores por defecto de `Settings`.
2. `settings.json` en la raíz del proyecto (ver `settings.example.json`).
3. Variables de entorno `RAGLAB_<CLAVE>` (p. ej. `RAGLAB_CORPUS_ROOT=/ruta/a/DOGV_CORPUS`).

Las rutas relativas (`corpus_root`, `cache_dir`) se resuelven desde la raíz del proyecto.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    # --- Corpus
    corpus_root: str = "data/DOGV_SAMPLE"
    variant: str = "pymupdf"                 # "deepseek" con el DOGV_CORPUS completo
    langs: list[str] = field(default_factory=lambda: ["va"])
    years: list[int] | None = None
    max_docs: int | None = None
    max_chars_per_doc: int | None = 40_000
    trim_to_own: bool = True

    # --- Modelos ("auto": e5-small en CPU, bge-m3 con GPU)
    device: str = "auto"
    embed_model: str = "auto"                # "hashing" para probar sin descargar modelos
    rerank_model: str | None = "BAAI/bge-reranker-v2-m3"
    k_candidates: int | None = None          # None: 15 en CPU, 30 en GPU

    # --- Chunking
    fixed_size: int = 1200
    fixed_overlap: int = 150
    structure_target: int = 1400
    structure_max: int = 2200

    # --- LLM (API tipo OpenAI)
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str | None = "deepseek-flash"
    llm_api_key_env: str | None = "DEEPSEEK_API_KEY"
    llm_extra_body: dict | None = field(default_factory=lambda: {"thinking": {"type": "disabled"}})

    # --- Generación
    answer_lang: str = "va"
    top_k: int = 5
    max_context_chars: int = 8000
    tau_ok: float = 0.5
    tau_abstain: float = 0.05
    agent_max_steps: int = 4                 # Agentic RAG: decisiones del agente, incluida la de terminar

    cache_dir: str = "indexes"               # caché de embeddings y BM25

    def to_dict(self) -> dict:
        return asdict(self)


def _coerce(raw: str, current):
    if isinstance(current, bool):
        return raw.lower() in ("1", "true", "yes", "si", "sí")
    if isinstance(current, int) and not isinstance(current, bool):
        return int(raw)
    if isinstance(current, float):
        return float(raw)
    if isinstance(current, (list, dict)) or current is None:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw if raw.lower() not in ("none", "null", "") else None
    return raw


def load_settings(path: Path | None = None) -> Settings:
    s = Settings()
    path = path or PROJECT_DIR / "settings.json"
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        names = {f.name for f in fields(s)}
        for k, v in data.items():
            if k in names:
                setattr(s, k, v)
    for f in fields(s):
        raw = os.environ.get(f"RAGLAB_{f.name.upper()}")
        if raw is not None:
            setattr(s, f.name, _coerce(raw, getattr(s, f.name)))
    for key in ("corpus_root", "cache_dir"):
        if not Path(getattr(s, key)).is_absolute():
            setattr(s, key, str(PROJECT_DIR / getattr(s, key)))
    return s


def _read_env_file(path: Path) -> dict[str, str]:
    """Pares CLAVE=valor de un fichero .env (se ignoran comentarios y líneas vacías)."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip("\"'")
    return out


def load_api_key(env_name: str | None) -> None:
    """Pone en el entorno la clave del LLM si aún no está.

    Busca, por orden: la variable de entorno, `.env` en la raíz (`DEEPSEEK_API_KEY=sk-…`) y, por compatibilidad,
    un fichero `<NOMBRE>.env` con la clave sola en una línea.
    """
    if not env_name or os.environ.get(env_name):
        return
    dotenv = PROJECT_DIR / ".env"
    if dotenv.is_file() and _read_env_file(dotenv).get(env_name):
        os.environ[env_name] = _read_env_file(dotenv)[env_name]
        return
    legacy = PROJECT_DIR / f"{env_name}.env"
    if legacy.is_file():
        lines = [ln.strip() for ln in legacy.read_text(encoding="utf-8").splitlines()]
        line = next((ln for ln in lines if ln and not ln.startswith("#")), "")
        os.environ[env_name] = line.split("=", 1)[-1].strip().strip("\"'")
