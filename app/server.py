"""Servidor del RAG Lab (FastAPI): sirve la interfaz de `web/` y la API.

    python run.py               # http://127.0.0.1:8000

La API:

    GET  /api/status                 estado de la carga, modelos, LLM y configuración de cada arquitectura
    GET  /api/corpus                 disposiciones, estadísticas y longitudes de chunks
    GET  /api/doc/{doc_id}           texto de una disposición y cómo la trocea cada chunker
    GET  /api/map/{index}            proyección PCA de los embeddings del índice
    GET  /api/examples               títulos al azar para inspirar preguntas
    POST /api/run                    ejecuta una arquitectura y emite cada etapa en streaming (NDJSON)
    GET  /api/runs/{id}              eventos de una ejecución ya terminada (las últimas 300 se guardan en memoria)
    GET  /embed/run/{id}             vista compacta y animada de una ejecución, para incrustar (Open WebUI)
    POST /api/grounding              apoyo de cada frase de la respuesta en el contexto
    POST /api/llm                    conecta otro LLM (la clave se queda en memoria)
    POST /api/eval  ·  GET /api/eval/{id}   evaluación de retrieval en segundo plano

Con RAGLAB_PUBLIC=1 se desactiva POST /api/llm: nadie puede cambiar desde fuera el servidor del LLM ni pedir que
se envíe como clave otra variable de entorno.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import PROJECT_DIR, load_settings
from .embed_bundle import page as embed_page
from .engine import PIPELINE_INFO, Engine

STATIC = PROJECT_DIR / "web"
settings = load_settings()
engine = Engine(settings)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine.start()          # la carga (corpus, índices, modelos) va en un hilo: la interfaz muestra el progreso
    yield


app = FastAPI(title="RAG Lab · DOGV", docs_url="/api/docs", lifespan=lifespan)
PUBLIC = os.environ.get("RAGLAB_PUBLIC", "").lower() in ("1", "true", "yes")
RUNS: OrderedDict[str, dict] = OrderedDict()   # ejecuciones recientes, para reabrirlas o incrustarlas
MAX_RUNS = 300
HISTORY_TURNS = 4                                # turnos de conversación que se usan para entender un seguimiento

# Las vistas incrustadas (iframes sin «same origin» en Open WebUI) cargan módulos y datos desde otro origen.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


@app.middleware("http")
async def _no_cache_ui(request, call_next):
    """La interfaz se revalida en cada carga: sin compilación ni hash en los nombres, así no queda JS viejo."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def _ready() -> None:
    if not engine.status["ready"]:
        raise HTTPException(503, engine.status.get("error") or "El laboratorio aún se está cargando.")


# --------------------------------------------------------------------------- lectura


@app.get("/api/status")
def status():
    out = {"status": {k: v for k, v in engine.status.items() if k != "log"},
           "log": engine.status["log"][-12:], "info": PIPELINE_INFO}
    if engine.status["ready"]:
        out.update(
            models=engine.models, llm=engine.llm_status(),
            llm_defaults={"base_url": settings.llm_base_url, "model": settings.llm_model,
                          "api_key_env": settings.llm_api_key_env},
            pipelines={n: engine.pipeline_config(n) for n in engine.pipelines},
            indexes={n: {"chunks": len(i), "docs": int(i.chunks["doc_id"].nunique()), "contextual": i.contextual,
                         "bm25": i.bm25 is not None} for n, i in engine.indexes.items()},
            corpus={"root": settings.corpus_root, "variant": settings.variant, "langs": settings.langs,
                    "docs": len(engine.docs),
                    "dates": [min(d.date for d in engine.docs), max(d.date for d in engine.docs)]},
        )
    return out


@app.get("/api/corpus")
def corpus():
    _ready()
    return engine.corpus_payload()


@app.get("/api/doc/{doc_id}")
def document(doc_id: str):
    _ready()
    if doc_id not in engine.doc_by_id:
        raise HTTPException(404, "Disposición no encontrada")
    return engine.document(doc_id)


@app.get("/api/map/{index}")
def embedding_map(index: str):
    _ready()
    if index not in engine.indexes:
        raise HTTPException(404, "Índice desconocido")
    return engine.map_payload(index)


@app.get("/api/examples")
def examples(n: int = 8, seed: int | None = None):
    _ready()
    return engine.examples(n, seed)


# --------------------------------------------------------------------------- consultas


class ChatTurn(BaseModel):
    question: str
    answer: str = ""


class RunRequest(BaseModel):
    question: str
    pipeline: str = "advanced"
    filters: dict = Field(default_factory=dict)
    options: dict = Field(default_factory=dict)
    generate: bool = True
    history: list[ChatTurn] = Field(default_factory=list)   # turnos anteriores de la conversación (modo simple)


@app.post("/api/run")
def run(req: RunRequest):
    """Emite un objeto JSON por línea (NDJSON) a medida que el pipeline avanza."""
    _ready()
    if req.pipeline not in engine.pipelines:
        raise HTTPException(404, "Arquitectura desconocida")
    if not req.question.strip():
        raise HTTPException(400, "Escribe una pregunta")
    q: queue.Queue = queue.Queue()
    done = object()
    run_id = uuid.uuid4().hex[:12]
    record = {"id": run_id, "question": req.question.strip(), "pipeline": req.pipeline, "created": time.time(), "events": []}
    RUNS[run_id] = record
    while len(RUNS) > MAX_RUNS:
        RUNS.popitem(last=False)

    def emit(ev: dict) -> None:
        if ev.get("type") == "start":
            ev["run_id"] = run_id
        record["events"].append(ev)
        q.put(ev)

    def worker():
        try:
            history = [t.model_dump() for t in req.history[-HISTORY_TURNS:]]
            engine.run(req.question.strip(), req.pipeline, req.filters, req.options, req.generate, emit, history=history)
        except Exception as exc:  # el error llega a la interfaz como un evento más
            emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            q.put(done)

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            item = q.get()
            if item is done:
                break
            yield json.dumps(item, ensure_ascii=False, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Run-Id": run_id})


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    record = RUNS.get(run_id)
    if record is None:
        raise HTTPException(404, "Ejecución no encontrada (solo se guardan las más recientes, en memoria)")
    return record


class GroundingRequest(BaseModel):
    answer: str
    contexts: list[str]


@app.post("/api/grounding")
def grounding(req: GroundingRequest):
    _ready()
    return engine.grounding(req.answer, req.contexts)


class LLMRequest(BaseModel):
    base_url: str = ""
    model: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    extra_body: dict | None = None


@app.post("/api/llm")
def connect_llm(req: LLMRequest):
    if PUBLIC:
        raise HTTPException(403, "Desactivado en modo público (RAGLAB_PUBLIC).")
    _ready()
    return engine.connect_llm(req.base_url.strip(), (req.model or "").strip() or None, req.api_key,
                              req.api_key_env, req.extra_body)


class EvalRequest(BaseModel):
    kind: str = "titles"            # "titles" | "synthetic" | "custom"
    n: int = 30
    pipelines: list[str] = Field(default_factory=lambda: ["naive", "hybrid", "advanced"])
    custom: list[dict] | None = None


@app.post("/api/eval")
def start_eval(req: EvalRequest):
    _ready()
    return {"id": engine.start_eval(req.kind, max(1, min(req.n, 300)), req.pipelines, req.custom)}


@app.get("/api/eval/{job_id}")
def eval_status(job_id: str):
    job = engine.evals.get(job_id)
    if job is None:
        raise HTTPException(404, "Evaluación no encontrada")
    return job


# --------------------------------------------------------------------------- interfaz


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/embed/run/{run_id}")
def embed_run(run_id: str):
    return FileResponse(STATIC / "embed.html", headers={"Cache-Control": "no-cache"})


@app.get("/embed/html/{run_id}")
def embed_html(run_id: str, base: str = ""):
    """La misma vista como HTML autocontenido (estilos, código y datos dentro), para incrustarlo por contenido.

    Open WebUI pinta así los embeds que no son URL (iframe srcdoc con sandbox): no pide nada al RAG Lab, así que
    funciona sea cual sea el navegador, la red o la configuración del sandbox. `base` (URL pública del RAG Lab)
    solo se usa para el enlace «Abrir en RAG Lab».
    """
    record = RUNS.get(run_id)
    if record is None:
        raise HTTPException(404, "Ejecución no encontrada")
    if base and not base.startswith(("http://", "https://")):
        raise HTTPException(400, "base debe ser una URL http(s)")
    return HTMLResponse(embed_page(record, base.rstrip("/")))


app.mount("/static", StaticFiles(directory=STATIC), name="static")
