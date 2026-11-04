"""Instrumentación de los pipelines: convierte cada etapa real en un evento JSON para la interfaz.

La web no reimplementa ningún pipeline. Durante cada consulta se envuelven, solo en esa instancia, los métodos de
los componentes reales (embedder, retrievers, fusión RRF, reranker, LLM y el gancho `_notify` del agente) para
emitir un evento por etapa con lo que entra, lo que sale y cuánto tarda. Al terminar se restauran.

Todos los eventos llevan `type`, `t` (ms desde el inicio), `pass` (pasada de retrieval) y `chunks` (metadatos de
los chunks que aparecen por primera vez). Tipos: embed, dense, bm25, fusion, candidates, rerank, llm_start, llm,
agent_plan, agent_obs, agent_done (y start, result, error, que emite el motor).
"""
from __future__ import annotations

import contextlib
import time
from collections import Counter
from collections.abc import Callable
from typing import TYPE_CHECKING

import numpy as np

from dogvrag import prompts
from dogvrag.retrieval import HybridRetriever

if TYPE_CHECKING:
    from .engine import Engine

Emit = Callable[[dict], None]

# parámetros que se pueden ajustar por consulta desde la interfaz (atributo -> objeto que lo tiene)
TUNABLE = {
    "top_k": "pipeline", "k_candidates": "pipeline", "window": "pipeline", "reorder": "pipeline",
    "max_context_chars": "pipeline", "tau_ok": "pipeline",
    "tau_abstain": "pipeline", "tau_context": "pipeline", "use_hyde": "pipeline", "n_rewrites": "pipeline",
    "max_steps": "pipeline",
    "dense_weight": "retriever", "sparse_weight": "retriever", "rrf_k": "retriever", "k_each": "retriever",
}


def rounded(x, nd=4):
    return None if x is None else round(float(x), nd)


class Recorder:
    """Recibe las llamadas interceptadas y las convierte en eventos JSON para la interfaz."""

    LIST_LIMIT = 25

    def __init__(self, engine: Engine, pipeline, emit: Emit):
        self.engine, self.pipe, self.emit = engine, pipeline, emit
        self.index = pipeline.index
        self.t0 = time.perf_counter()
        self.sent: set[int] = set()
        self.pending: list[dict] = []          # listas densas/BM25 desde la última fusión
        self.passes = 0
        self.query_vec: np.ndarray | None = None
        self.query_tokens: list[str] = []

    def now(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def meta(self, ids) -> dict:
        new = [int(i) for i in ids if int(i) not in self.sent]
        self.sent.update(new)
        return {str(i): self.engine.chunk_meta(self.index, i) for i in new}

    def push(self, kind: str, ids=(), **data) -> None:
        self.emit({"type": kind, "t": self.now(), "pass": max(self.passes, 1), **data, "chunks": self.meta(ids)})

    @staticmethod
    def hits(hits, limit=None) -> list[dict]:
        out = []
        for h in hits[:limit] if limit else hits:
            out.append({"id": int(h.chunk_id), "s": rounded(h.score),
                        "sc": {k: rounded(v) for k, v in h.scores.items()}})
        return out


@contextlib.contextmanager
def patched(obj, name: str, wrapper_factory):
    """Sustituye `obj.name` por un envoltorio solo en esta instancia y lo deshace al salir."""
    own = name in vars(obj)
    original = getattr(obj, name)
    setattr(obj, name, wrapper_factory(original))
    try:
        yield
    finally:
        if own:
            setattr(obj, name, original)
        else:
            delattr(obj, name)                 # vuelve al método de la clase


@contextlib.contextmanager
def instrument(pipe, rec: Recorder):
    stack = contextlib.ExitStack()
    index = pipe.index
    tokenizer = index.bm25.tokenizer if index.bm25 is not None else None

    def wrap_embed(orig):
        def f(texts):
            t = time.perf_counter()
            vecs = orig(texts)
            ms = (time.perf_counter() - t) * 1000
            for text, v in zip(texts, vecs, strict=True):
                if rec.query_vec is None:
                    rec.query_vec = np.asarray(v, dtype=np.float32)
                rec.push("embed", text=text[:600], dim=int(v.shape[0]), ms=round(ms, 1),
                         preview=[rounded(x, 3) for x in v[:96]], norm=rounded(np.linalg.norm(v)))
            return vecs
        return f

    def wrap_dense(orig):
        def f(query, k=10, filters=None):
            t = time.perf_counter()
            hits = orig(query, k, filters)
            ms = (time.perf_counter() - t) * 1000
            rec.pending.append({"kind": "dense", "query": query, "ranks": {h.chunk_id: r for r, h in enumerate(hits, 1)}})
            shown = hits[: rec.LIST_LIMIT]
            rec.push("dense", [h.chunk_id for h in shown], query=query[:600], k=k, n=len(hits), ms=round(ms, 1),
                     hits=rec.hits(shown))
            return hits
        return f

    def wrap_sparse(orig):
        def f(query, k=10, filters=None):
            t = time.perf_counter()
            hits = orig(query, k, filters)
            ms = (time.perf_counter() - t) * 1000
            rec.pending.append({"kind": "bm25", "query": query, "ranks": {h.chunk_id: r for r, h in enumerate(hits, 1)}})
            shown = hits[: rec.LIST_LIMIT]
            q_tokens = tokenizer(query) if tokenizer else []
            if not rec.query_tokens:
                rec.query_tokens = q_tokens
            qset = set(q_tokens)
            items = rec.hits(shown)
            for item in items:
                row = index.chunks.iloc[item["id"]]
                toks = Counter(tokenizer(row["header"] + "\n\n" + row["text"])) if tokenizer else Counter()
                item["terms"] = {t: toks[t] for t in q_tokens if toks.get(t)}
            rec.push("bm25", [h.chunk_id for h in shown], query=query[:600], tokens=q_tokens, k=k, n=len(hits),
                     ms=round(ms, 1), hits=items, vocab_hit=len(qset))
            return hits
        return f

    def wrap_multi(orig):
        def f(dense_q, sparse_q, k=10, filters=None):
            rec.passes += 1
            rec.pending = []
            t = time.perf_counter()
            hits = orig(dense_q, sparse_q, k, filters)
            ms = (time.perf_counter() - t) * 1000
            lists = [{"kind": p["kind"], "query": p["query"][:200]} for p in rec.pending]
            shown = hits[: rec.LIST_LIMIT + 5]
            items = rec.hits(shown)
            for item in items:
                item["r"] = [p["ranks"].get(item["id"]) for p in rec.pending]
            rec.push("fusion", [h.chunk_id for h in shown], lists=lists, n=len(hits), ms=round(ms, 1), hits=items,
                     rrf_k=pipe.retriever.rrf_k,
                     weights={"dense": pipe.retriever.dense_weight, "bm25": pipe.retriever.sparse_weight})
            return hits
        return f

    def wrap_candidates(orig):
        def f(dense_q, sparse_q, filters):
            hits = orig(dense_q, sparse_q, filters)
            rec.push("candidates", [h.chunk_id for h in hits], hits=rec.hits(hits), n=len(hits),
                     k_candidates=pipe.k_candidates)
            return hits
        return f

    def wrap_rerank(orig):
        def f(question, hits):
            before = {h.chunk_id: r for r, h in enumerate(hits, 1)}
            t = time.perf_counter()
            out = orig(question, hits)
            ms = (time.perf_counter() - t) * 1000
            if pipe.reranker is not None and out:
                items = rec.hits(out)
                for item in items:
                    item["prev"] = before.get(item["id"])
                rec.push("rerank", [h.chunk_id for h in out], ms=round(ms, 1), hits=items,
                         model=getattr(pipe.reranker, "name", "reranker"))
            return out
        return f

    def wrap_generate(orig):
        def f(messages, max_tokens=700, temperature=0.1):
            content = messages[-1]["content"]
            lang = pipe.answer_lang if pipe.answer_lang in prompts.SYSTEM else "va"
            purpose = "answer"
            if messages[0]["role"] == "system" and messages[0]["content"][:60] == prompts.AGENT[lang][:60]:
                purpose = "agent"
            elif messages[0]["role"] != "system":
                purpose = "rewrite" if prompts.REWRITE[lang][:50] in content else (
                    "hyde" if prompts.HYDE[lang][:50] in content else "other")
            rec.push("llm_start", purpose=purpose)
            t = time.perf_counter()
            out = orig(messages, max_tokens, temperature)
            ms = (time.perf_counter() - t) * 1000
            rec.push("llm", purpose=purpose, ms=round(ms, 1), output=out, max_tokens=max_tokens,
                     temperature=temperature, messages=messages if purpose not in ("answer", "agent") else None)
            return out
        return f

    with stack:
        stack.enter_context(patched(index.embedder, "embed_queries", wrap_embed))
        retr = pipe.retriever
        if isinstance(retr, HybridRetriever):
            stack.enter_context(patched(retr.dense, "retrieve", wrap_dense))
            stack.enter_context(patched(retr.sparse, "retrieve", wrap_sparse))
            stack.enter_context(patched(retr, "retrieve_multi", wrap_multi))
            stack.enter_context(patched(pipe, "_candidates", wrap_candidates))
            stack.enter_context(patched(pipe, "_rerank", wrap_rerank))
        else:
            stack.enter_context(patched(retr, "retrieve", wrap_dense))
        if pipe.generator.available:
            stack.enter_context(patched(pipe.generator, "generate", wrap_generate))
        if hasattr(pipe, "_notify"):       # decisiones y observaciones del agente (AgenticRAG)
            stack.enter_context(patched(pipe, "_notify", lambda orig: lambda kind, ids=(), **d: rec.push(kind, ids, **d)))
        yield


@contextlib.contextmanager
def overrides(pipe, options: dict, generator=None):
    """Aplica parámetros de la interfaz solo durante una consulta."""
    saved = []
    for key, value in (options or {}).items():
        target = TUNABLE.get(key)
        obj = pipe if target == "pipeline" else getattr(pipe, "retriever", None)
        if obj is None or value is None or not hasattr(obj, key):
            continue
        current = getattr(obj, key)
        cast = type(current) if current is not None else (lambda x: x)
        try:
            value = (value if isinstance(value, bool) else str(value).lower() in ("1", "true")) \
                if isinstance(current, bool) else cast(value)
        except (TypeError, ValueError):
            continue
        saved.append((obj, key, current))
        setattr(obj, key, value)
    if generator is not None:
        saved.append((pipe, "generator", pipe.generator))
        pipe.generator = generator
    try:
        yield
    finally:
        for obj, key, value in reversed(saved):
            setattr(obj, key, value)
