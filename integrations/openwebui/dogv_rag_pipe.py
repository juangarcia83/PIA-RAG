"""
title: DOGV RAG Lab
author: ValgrAI · rag_dogv_lab
version: 0.1.0
description: Las arquitecturas RAG del estudio DOGV (Naive, Híbrido, Advanced, Corrective, Agentic) como modelos de Open WebUI. Cada respuesta muestra las etapas en directo, cita las disposiciones y puede incrustar el proceso animado del RAG Lab.
requirements: httpx
"""
# Esta función no reimplementa nada: llama al servidor del RAG Lab (`python run.py`), que ejecuta los mismos
# pipelines que el notebook, y traduce sus eventos al formato de Open WebUI:
#   etapas del pipeline  -> eventos «status»   (texto bajo la respuesta mientras se genera)
#   fragmentos del prompt -> eventos «source»   (chips [1], [2]… con el texto citado y el enlace al PDF)
#   ejecución completa    -> evento «embeds»    (iframe con el grafo animado y el recorrido de candidatos)
from __future__ import annotations

import json
import re
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any

import httpx
from pydantic import BaseModel, Field

PIPELINES = {
    "naive": {"es": "Naive", "va": "Naive"},
    "hybrid": {"es": "Híbrido", "va": "Híbrid"},
    "advanced": {"es": "Advanced", "va": "Advanced"},
    "corrective": {"es": "Corrective", "va": "Corrective"},
    "agentic": {"es": "Agentic", "va": "Agentic"},
}

# Marcas frecuentes del valenciano que no aparecen en castellano (para ANSWER_LANG = "auto").
_VA_HINTS = re.compile(
    r"\b(quins?|quines|què|perquè|també|amb|els|les|dels|per a|són|això|aquest|esta|estos|hi ha|"
    r"s'han|d'|l'|ajuntaments|convocatòria|subvencions|disposicions)\b", re.I)


def _lang(text: str, setting: str) -> str:
    if setting in ("va", "es"):
        return setting
    return "va" if len(_VA_HINTS.findall(text)) >= 2 else "es"


def _status_text(ev: dict, lang: str, reranker: bool = True) -> str | None:
    """Una línea corta por etapa, en el idioma de la pregunta."""
    va = lang == "va"
    kind = ev.get("type")
    second = ev.get("pass", 1) > 1
    tag = (f" (passada {ev['pass']})" if va else f" (pasada {ev['pass']})") if second else ""
    if kind == "start":
        return "Rebuda la consulta" if va else "Consulta recibida"
    if kind == "embed":
        return (f"Embedding de la consulta · {ev['dim']} dimensions" if va else f"Embedding de la consulta · {ev['dim']} dimensiones") + tag
    if kind == "dense":
        label = "Cerca densa" if va else "Búsqueda densa"
        if ev.get("hits"):
            label += f" · {'millor' if va else 'mejor'} similitud {ev['hits'][0]['s']:.3f}"
        return label + tag
    if kind == "bm25":
        terms = ", ".join(ev.get("tokens", [])[:6])
        return (f"BM25 · termes: {terms}" if va else f"BM25 · términos: {terms}") + tag
    if kind == "fusion":
        return (f"Fusió RRF de {len(ev.get('lists', []))} llistes" if va else f"Fusión RRF de {len(ev.get('lists', []))} listas") + tag
    if kind == "candidates":
        if not reranker:
            return (f"{ev['n']} candidats sense duplicats" if va else f"{ev['n']} candidatos sin duplicados") + tag
        return (f"Reranker: llegint {ev['n']} candidats…" if va else f"Reranker: leyendo {ev['n']} candidatos…") + tag
    if kind == "rerank":
        best = ev["hits"][0]["s"] if ev.get("hits") else 0
        return (f"Reranking fet · millor score {best:.2f}" if va else f"Reranking hecho · mejor score {best:.2f}") + tag
    if kind == "agent_plan":
        step = f"{ev['step']}/{ev['max_steps']}"
        if ev.get("action") == "search":
            return (f"Agent · pas {step}: busca «{ev.get('query', '')}»" if va else f"Agente · paso {step}: busca «{ev.get('query', '')}»")
        if ev.get("action") == "read":
            return (f"Agent · pas {step}: llig {ev.get('ref', '')} sencer" if va else f"Agente · paso {step}: lee {ev.get('ref', '')} entero")
        refs = ", ".join(ev.get("evidence") or [])
        return (f"Agent · pas {step}: acaba ({refs or 'sense evidències'})" if va else f"Agente · paso {step}: termina ({refs or 'sin evidencias'})")
    if kind == "agent_done":
        n, m = len(ev.get("evidence", [])), ev.get("n_pool", 0)
        return f"{n} de {m} evidències triades" if va else f"{n} de {m} evidencias elegidas"
    if kind == "llm_start":
        return {
                "agent": "L'agent decidix el pas següent…" if va else "El agente decide el siguiente paso…","rewrite": "Retrieval feble: reformulant la pregunta…" if va else "Retrieval flojo: reformulando la pregunta…",
                "hyde": "Escrivint un document hipotètic (HyDE)…" if va else "Escribiendo un documento hipotético (HyDE)…",
                }.get(ev.get("purpose"), "Generant la resposta…" if va else "Generando la respuesta…")
    return None


def _question(messages: list[dict]) -> str:
    for m in reversed(messages or []):
        if m.get("role") != "user":
            continue
        content = m.get("content", "")
        if isinstance(content, list):   # mensajes multimodales: solo las partes de texto
            content = " ".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
        return str(content).strip()
    return ""


class Pipe:
    class Valves(BaseModel):
        RAGLAB_URL: str = Field(default="http://localhost:8000",
                                description="URL del servidor RAG Lab tal como la ve Open WebUI (backend).")
        RAGLAB_PUBLIC_URL: str = Field(default="http://localhost:8000",
                                       description="URL del RAG Lab tal como la ve el navegador del usuario (para incrustar el proceso).")
        ANSWER_LANG: str = Field(default="auto", description="Idioma de la respuesta: auto (el de la pregunta), va o es.")
        SHOW_PROCESS: bool = Field(default=True, description="Incrustar bajo cada respuesta el proceso animado del RAG Lab.")
        EMBED_MODE: str = Field(default="html", description="html: el proceso se incrusta por contenido (funciona con cualquier sandbox). url: iframe que carga la URL del RAG Lab.")
        TIMEOUT_SECONDS: int = Field(default=600, description="Tiempo máximo por consulta (el reranker en CPU es lento).")

    def __init__(self):
        self.name = "DOGV · "
        self.valves = self.Valves()

    def pipes(self) -> list[dict]:
        return [{"id": pid, "name": names["es"]} for pid, names in PIPELINES.items()]

    async def pipe(
        self,
        body: dict,
        __user__: dict | None = None,
        __event_emitter__: Callable[[dict], Awaitable[None]] | None = None,
        __task__: str | None = None,
    ) -> AsyncGenerator[str, None] | str:
        pipeline = str(body.get("model", "")).rsplit(".", 1)[-1]
        if pipeline not in PIPELINES:
            pipeline = "advanced"
        question = _question(body.get("messages", []))

        # Open WebUI usa el modelo del chat para tareas auxiliares (título, etiquetas, sugerencias).
        # No tiene sentido lanzar el RAG para eso: se responde con algo mínimo y válido.
        if __task__:
            return self._task(__task__, question)

        if not question:
            return "Escribe una pregunta sobre el DOGV."
        lang = _lang(question, self.valves.ANSWER_LANG)
        return self._run(pipeline, question, lang, __event_emitter__)

    # ------------------------------------------------------------------ tareas auxiliares
    @staticmethod
    def _task(task: str, prompt: str) -> str:
        if "title" in task:
            m = re.findall(r"USER:\s*(.+)", prompt)
            words = (m[-1] if m else "Consulta al DOGV").split()
            return json.dumps({"title": " ".join(words[:7])[:60]}, ensure_ascii=False)
        if "tags" in task:
            return json.dumps({"tags": ["DOGV", "RAG"]})
        if "follow" in task:
            return json.dumps({"follow_ups": []})
        if "query" in task:
            return json.dumps({"queries": []})
        return ""

    # ------------------------------------------------------------------ proceso incrustado
    async def _embed(self, run_id: str, lang: str) -> str | None:
        """URL del proceso animado o, en modo «html», el documento completo (Open WebUI lo pinta en un srcdoc)."""
        public = self.valves.RAGLAB_PUBLIC_URL.rstrip("/")
        if self.valves.EMBED_MODE == "url":
            return f"{public}/embed/run/{run_id}?lang={lang}"
        url = f"{self.valves.RAGLAB_URL.rstrip('/')}/embed/html/{run_id}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url, params={"base": public, "lang": lang})
                r.raise_for_status()
                return r.text
        except httpx.HTTPError:
            return None

    # ------------------------------------------------------------------ ejecución
    async def _run(self, pipeline: str, question: str, lang: str,
                   emit: Callable[[dict], Awaitable[None]] | None) -> AsyncGenerator[str, None]:
        async def status(text: str, done: bool = False) -> None:
            if emit:
                await emit({"type": "status", "data": {"description": text, "done": done}})

        url = self.valves.RAGLAB_URL.rstrip("/") + "/api/run"
        payload = {"question": question, "pipeline": pipeline, "options": {"answer_lang": lang}, "generate": True}
        result: dict[str, Any] | None = None
        run_id = None
        reranker = True
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.valves.TIMEOUT_SECONDS, connect=10)) as client:
                async with client.stream("POST", url, json=payload) as resp:
                    if resp.status_code >= 400:
                        detail = (await resp.aread()).decode("utf-8", "replace")[:400]
                        raise RuntimeError(f"RAG Lab respondió {resp.status_code}: {detail}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        ev = json.loads(line)
                        if ev.get("type") == "start":
                            run_id = ev.get("run_id")
                            reranker = bool((ev.get("config") or {}).get("reranker"))
                        if ev.get("type") == "error":
                            raise RuntimeError(ev.get("message", "error"))
                        if ev.get("type") == "result":
                            result = ev
                            continue
                        text = _status_text(ev, lang, reranker)
                        if text:
                            await status(text)
        except httpx.ConnectError:
            await status("Sense connexió amb el RAG Lab" if lang == "va" else "Sin conexión con el RAG Lab", done=True)
            yield (f"No he pogut connectar amb el RAG Lab en `{self.valves.RAGLAB_URL}`. Comprova que el servidor està en marxa (`python run.py`)."
                   if lang == "va" else
                   f"No he podido conectar con el RAG Lab en `{self.valves.RAGLAB_URL}`. Comprueba que el servidor está en marcha (`python run.py`).")
            return

        if result is None:
            await status("Sense resultat" if lang == "va" else "Sin resultado", done=True)
            yield "—"
            return

        # fuentes: en el mismo orden que el prompt, para que las citas [n] de la respuesta apunten a la correcta
        if emit:
            for c in result.get("contexts", []):
                title = c.get("title") or c.get("code", "")
                await emit({"type": "source", "data": {
                    "source": {"name": f"[{c['n']}] {c.get('code', '')} · {title[:90]}", "id": f"{c.get('code', '')}#{c['n']}"},
                    "document": [c.get("text", "")],
                    # «source» único por fragmento: Open WebUI agrupa las citas por este campo, y varios fragmentos
                    # de la misma disposición comparten URL; si se agruparan, las citas [n] dejarían de cuadrar.
                    "metadata": [{"source": f"{c.get('url') or c.get('code', '')}#fragment-{c['n']}",
                                  "name": f"[{c['n']}] {c.get('citation', '')} — {title}", "url": c.get("url", "")}],
                }})
            if self.valves.SHOW_PROCESS and run_id:
                embed = await self._embed(run_id, lang)
                if embed:
                    await emit({"type": "embeds", "data": {"embeds": [embed], "replace": True}})

        secs = result.get("total_ms", 0) / 1000
        n = len(result.get("contexts", []))
        verdict = (result.get("trace") or {}).get("verdict")
        tail = f" · {verdict}" if verdict and pipeline == "corrective" else ""
        steps = (result.get("trace") or {}).get("steps")
        if steps and pipeline == "agentic":
            tail = f" · {len(steps)} passos" if lang == "va" else f" · {len(steps)} pasos"
        await status((f"Fet en {secs:.1f} s · {n} fragments{tail}" if lang == "va" else f"Listo en {secs:.1f} s · {n} fragmentos{tail}"), done=True)

        answer = result.get("answer") or ""
        if not result.get("generated"):
            answer = ("El RAG Lab no té cap LLM connectat: es mostren només els fragments recuperats (vegeu les fonts)."
                      if lang == "va" else
                      "El RAG Lab no tiene ningún LLM conectado: se muestran solo los fragmentos recuperados (ver las fuentes).")
        yield answer
