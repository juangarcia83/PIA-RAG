"""Motor de la web: monta las arquitecturas de `dogvrag`, atiende las consultas y las evaluaciones.

Carga el corpus, construye (o lee de la caché) los índices, carga los modelos y crea un objeto por arquitectura.
Cada consulta se ejecuta con los componentes instrumentados (ver `instrumentation.py`) y bajo un lock: es un
laboratorio para una persona, no un servicio con concurrencia.
"""
from __future__ import annotations

import contextlib
import random
import re
import threading
import time
import traceback
from collections import Counter
from collections.abc import Callable

import numpy as np

import dogvrag as dr
from dogvrag import prompts
from dogvrag.generation import NullGenerator
from dogvrag.index import build_chunk_table, make_header
from dogvrag.retrieval import Filters, HybridRetriever

from .config import Settings, load_api_key
from .instrumentation import Emit, Recorder, instrument, overrides, patched, rounded

PIPELINE_INFO = {
    "naive": {"label": "Naive", "index": "naive",
              "summary": "Chunks de tamaño fijo, retrieval denso top-k y generación."},
    "hybrid": {"label": "Híbrido", "index": "advanced",
               "summary": "Ablation: BM25 + denso con RRF sobre chunks estructurales, sin reranker."},
    "advanced": {"label": "Advanced", "index": "advanced",
                 "summary": "Híbrido BM25 + denso (RRF), reranking con cross-encoder y reordenación del contexto."},
    "corrective": {"label": "Corrective", "index": "advanced",
                   "summary": "Advanced + evaluador de relevancia: reformula (multi-query + HyDE) o se abstiene."},
    "agentic": {"label": "Agentic", "index": "advanced",
                "summary": "Un LLM agente planifica: decide qué buscar, con qué filtros, qué leer entero y cuándo parar."},
}

_CITE_RE = re.compile(r"\[(\d+)\]")
_SENT_RE = re.compile(r"(?<=[.!?;:])\s+(?=[A-ZÀ-ÚÇ¿¡«\"(\d])|\n+")


class _ProgressEmbedder:
    """Delegado del embedder que cuenta los chunks embebidos, para la barra de progreso de la carga."""

    def __init__(self, inner, on_docs: Callable[[int], None]):
        self._inner, self._on_docs = inner, on_docs
        self.name, self.dim = inner.name, inner.dim

    def embed_documents(self, texts, show_progress=False):
        out = self._inner.embed_documents(texts)
        self._on_docs(len(texts))
        return out

    def embed_queries(self, texts):
        return self._inner.embed_queries(texts)


class Engine:
    def __init__(self, settings: Settings):
        self.s = settings
        self.lock = threading.Lock()
        self.status = {"ready": False, "phase": "pending", "message": "Esperando…", "progress": 0.0,
                       "error": None, "log": []}
        self.docs: list = []
        self.doc_by_id: dict = {}
        self.stats = None
        self.indexes: dict = {}
        self.chunkers: dict = {}
        self.pipelines: dict = {}
        self.projections: dict = {}
        self.embedder = None
        self.reranker = None
        self.generator = NullGenerator("sin configurar")
        self.models: dict = {}
        self.evals: dict = {}

    # ------------------------------------------------------------------ carga

    def _phase(self, phase: str, message: str, progress: float | None = None) -> None:
        self.status.update(phase=phase, message=message)
        if progress is not None:
            self.status["progress"] = round(progress, 3)
        self.status["log"].append({"t": time.strftime("%H:%M:%S"), "msg": message})
        print(f"[raglab] {message}", flush=True)

    def start(self) -> None:
        threading.Thread(target=self._load, daemon=True, name="raglab-loader").start()

    def _load(self) -> None:
        try:
            s = self.s
            self._phase("corpus", f"Leyendo corpus en {s.corpus_root}", 0.02)
            cfg = dr.CorpusConfig(root=s.corpus_root, langs=tuple(s.langs), variant=s.variant,
                                  years=tuple(s.years) if s.years else None, max_docs=s.max_docs,
                                  max_chars_per_doc=s.max_chars_per_doc, trim_to_own=s.trim_to_own)
            self.docs, self.stats = dr.load_documents(cfg, progress=False)
            self.doc_by_id = {d.doc_id: d for d in self.docs}
            self._phase("corpus", f"{len(self.docs)} disposiciones cargadas", 0.08)

            device = dr.resolve_device(s.device)
            on_cpu = device == "cpu"
            embed_model = s.embed_model if s.embed_model != "auto" else (
                "intfloat/multilingual-e5-small" if on_cpu else "BAAI/bge-m3")
            k_cand = s.k_candidates or (15 if on_cpu else 30)
            self._phase("models", f"Cargando embeddings {embed_model} en {device}", 0.10)
            inner = dr.HashingEmbedder() if embed_model == "hashing" else dr.SentenceTransformerEmbedder(
                embed_model, device=device)

            self.chunkers = {
                "naive": dr.FixedChunker(size=s.fixed_size, overlap=s.fixed_overlap),
                "advanced": dr.StructureChunker(target=s.structure_target, max=s.structure_max),
            }
            totals = {n: len(build_chunk_table(self.docs, c)) for n, c in self.chunkers.items()}
            grand = sum(totals.values())
            done = {"n": 0}

            def on_docs(n: int) -> None:
                done["n"] += n
                self.status["progress"] = round(0.15 + 0.65 * min(1.0, done["n"] / max(grand, 1)), 3)
                self.status["message"] = f"Calculando embeddings: {done['n']:,} / {grand:,} chunks".replace(",", ".")

            self.embedder = _ProgressEmbedder(inner, on_docs)
            specs = {"naive": dict(contextual=False, with_bm25=False),
                     "advanced": dict(contextual=True, with_bm25=True)}
            for name, chunker in self.chunkers.items():
                self._phase("index", f"Índice «{name}»: {totals[name]} chunks", None)
                self.indexes[name] = dr.build_index(name, self.docs, chunker, self.embedder, s.cache_dir,
                                                    verbose=False, **specs[name])
                done["n"] = max(done["n"], sum(totals[n] for n in self.indexes))
                self._phase("index", self.indexes[name].describe(), 0.15 + 0.65 * done["n"] / max(grand, 1))

            if s.rerank_model:
                self._phase("models", f"Cargando reranker {s.rerank_model}", 0.84)
                self.reranker = dr.CrossEncoderReranker(s.rerank_model, device=device)

            self._phase("llm", "Conectando con el LLM", 0.92)
            self.connect_llm(s.llm_base_url, s.llm_model, None, s.llm_api_key_env, s.llm_extra_body, rebuild=False)

            self.models = {"device": device, "embedder": embed_model, "dim": int(inner.dim),
                           "reranker": s.rerank_model, "k_candidates": k_cand}
            self._build_pipelines(k_cand)
            self._phase("projection", "Proyectando embeddings (PCA)", 0.96)
            for name, idx in self.indexes.items():
                self.projections[name] = self._project(idx)
            self.status.update(ready=True, phase="ready", progress=1.0,
                               message="Listo")
            print("[raglab] Listo", flush=True)
        except Exception as exc:  # se muestra en la interfaz
            traceback.print_exc()
            self.status.update(phase="error", error=f"{type(exc).__name__}: {exc}",
                               message="No se pudo cargar el laboratorio")

    def _build_pipelines(self, k_cand: int) -> None:
        s = self.s
        common = dict(generator=self.generator, top_k=s.top_k, answer_lang=s.answer_lang,
                      max_context_chars=s.max_context_chars)
        naive, adv = self.indexes["naive"], self.indexes["advanced"]
        self.pipelines = {
            "naive": dr.NaiveRAG(naive, **common),
            "hybrid": dr.AdvancedRAG(adv, reranker=None, name="hybrid", **common),
            "advanced": dr.AdvancedRAG(adv, reranker=self.reranker, k_candidates=k_cand, **common),
            "corrective": dr.CorrectiveRAG(adv, reranker=self.reranker, k_candidates=k_cand,
                                           tau_ok=s.tau_ok, tau_abstain=s.tau_abstain, **common),
            # cada búsqueda del agente pasa por el reranker: con menos candidatos por búsqueda, el coste total
            # (varias búsquedas) queda cerca del de Advanced
            "agentic": dr.AgenticRAG(adv, reranker=self.reranker, k_candidates=max(8, k_cand * 2 // 3),
                                     max_steps=s.agent_max_steps, **common),
        }

    def connect_llm(self, base_url: str, model: str | None, api_key: str | None, api_key_env: str | None,
                    extra_body: dict | None, rebuild: bool = True) -> dict:
        load_api_key(api_key_env)
        if not base_url:
            gen = NullGenerator("sin URL")
        else:
            gen = dr.connect_generator(base_url, model or None, api_key=api_key or None,
                                       api_key_env=api_key_env or None, extra_body=extra_body or None)
        self.generator = gen
        for p in self.pipelines.values():
            p.generator = gen
        return self.llm_status()

    def llm_status(self) -> dict:
        g = self.generator
        return {"available": bool(g.available), "name": getattr(g, "name", ""),
                "model": getattr(g, "model", None), "base_url": getattr(g, "base_url", None),
                "error": getattr(g, "error", "") or ""}

    # ------------------------------------------------------------------ datos

    def chunk_meta(self, index, cid: int) -> dict:
        c = index.chunks.iloc[int(cid)]
        return {"doc": c["doc_id"], "code": c["code"].replace("_", "/"), "title": c["title"][:220],
                "organismo": c["organismo"], "seccion": c["seccion"], "section": c["section"][:120],
                "date": c["date"], "lang": c["lang"], "idx": int(c["idx"]), "url": c["url"],
                "text": " ".join(c["text"][:420].split()), "len": len(c["text"])}

    def _project(self, index) -> dict:
        emb = np.asarray(index.dense.emb, dtype=np.float32)
        mean = emb.mean(axis=0)
        _, sv, vt = np.linalg.svd(emb - mean, full_matrices=False)
        comps = vt[:2]
        xy = (emb - mean) @ comps.T
        explained = float((sv[:2] ** 2).sum() / (sv ** 2).sum())
        return {"mean": mean, "comps": comps, "xy": xy, "explained": explained}

    def project_query(self, index_name: str, vec: np.ndarray | None) -> list[float] | None:
        p = self.projections.get(index_name)
        if p is None or vec is None:
            return None
        q = (vec - p["mean"]) @ p["comps"].T
        return [round(float(q[0]), 4), round(float(q[1]), 4)]

    def map_payload(self, index_name: str) -> dict:
        idx, p = self.indexes[index_name], self.projections[index_name]
        c = idx.chunks
        secs = c["seccion"].replace("", "(sin sección)")
        cats = list(secs.value_counts().index)
        cat_id = {k: i for i, k in enumerate(cats)}
        return {
            "index": index_name, "n": len(c), "explained": round(p["explained"], 4),
            "x": [round(float(v), 4) for v in p["xy"][:, 0]],
            "y": [round(float(v), 4) for v in p["xy"][:, 1]],
            "cat": [cat_id[v] for v in secs], "cats": cats,
            "code": [v.replace("_", "/") for v in c["code"]],
            "title": [t[:140] for t in c["title"]],
            "section": [t[:80] for t in c["section"]],
        }

    def corpus_payload(self) -> dict:
        docs = self.docs
        counts = {name: Counter(idx.chunks["doc_id"]) for name, idx in self.indexes.items()}
        items = [{"id": d.doc_id, "code": d.code.replace("_", "/"), "date": d.date, "num": d.dogv_num,
                  "lang": d.lang, "title": d.title, "organismo": d.organismo, "seccion": d.seccion,
                  "subseccion": d.subseccion, "chars": len(d.text), "trim": d.trim, "url": d.url,
                  "chunks": {n: c.get(d.doc_id, 0) for n, c in counts.items()}} for d in docs]
        lens = {name: [int(x) for x in idx.chunks["text"].str.len()] for name, idx in self.indexes.items()}
        st = self.stats
        return {
            "docs": items, "chunk_lengths": lens,
            "stats": {"files": st.files_found, "loaded": st.loaded, "skipped_short": st.skipped_short,
                      "truncated": st.truncated, "without_metadata": st.without_metadata,
                      "trim": dict(st.trim), "chars_raw": st.chars_raw, "chars_trimmed": st.chars_trimmed,
                      "by_year": {str(k): v for k, v in st.by_year.items()}, "by_lang": dict(st.by_lang)},
        }

    def document(self, doc_id: str) -> dict:
        d = self.doc_by_id[doc_id]
        segs = {}
        for name, chunker in self.chunkers.items():
            out, cursor = [], 0
            for i, p in enumerate(chunker.split(d.text)):
                probe = p.text[:80]
                start = d.text.find(probe, max(0, cursor - 400))
                if start < 0:
                    start = d.text.find(probe)
                if start < 0:
                    continue
                end = min(len(d.text), start + len(p.text))
                out.append({"i": i, "start": start, "end": end, "section": p.section, "len": len(p.text)})
                cursor = start + 1
            segs[name] = out
        header = make_header(d, "")
        return {"id": d.doc_id, "code": d.code.replace("_", "/"), "title": d.title, "title_alt": d.title_alt,
                "organismo": d.organismo, "seccion": d.seccion, "subseccion": d.subseccion, "date": d.date,
                "num": d.dogv_num, "lang": d.lang, "url": d.url, "trim": d.trim, "text": d.text,
                "segments": segs, "header": header,
                "config": {n: c.config() for n, c in self.chunkers.items()}}

    def examples(self, n: int = 8, seed: int | None = None) -> list[dict]:
        rng = random.Random(seed)
        pool = [d for d in self.docs if len(d.title) > 40]
        return [{"code": d.code.replace("_", "/"), "title": d.title[:200], "organismo": d.organismo}
                for d in rng.sample(pool, min(n, len(pool)))]

    # ------------------------------------------------------------------ consultas

    @staticmethod
    def filters(raw: dict | None) -> Filters | None:
        if not raw:
            return None
        keep = {k: v for k, v in raw.items() if v not in (None, "") and k in Filters.__dataclass_fields__}
        for k in ("year", "dogv_num"):
            if k in keep:
                keep[k] = int(keep[k])
        return Filters(**keep) if keep else None

    def pipeline_config(self, name: str) -> dict:
        p = self.pipelines[name]
        cfg = {"name": name, **PIPELINE_INFO[name], "top_k": p.top_k, "answer_lang": p.answer_lang,
               "max_context_chars": p.max_context_chars, "index_size": len(p.index),
               "chunker": self.chunkers[PIPELINE_INFO[name]["index"]].config(),
               "contextual": p.index.contextual}
        for key in ("k_candidates", "window", "reorder", "tau_ok", "tau_abstain", "tau_context", "use_hyde",
                    "n_rewrites", "max_steps"):
            if hasattr(p, key):
                cfg[key] = getattr(p, key)
        r = p.retriever
        if isinstance(r, HybridRetriever):
            cfg.update(k_each=r.k_each, rrf_k=r.rrf_k, dense_weight=r.dense_weight, sparse_weight=r.sparse_weight)
        cfg["reranker"] = getattr(getattr(p, "reranker", None), "name", None)
        return cfg

    def standalone_question(self, question: str, history: list[dict] | None) -> str:
        """Reescribe una pregunta de seguimiento como pregunta completa con la conversación (si hay LLM)."""
        if not history or not self.generator.available:
            return question
        try:
            out = self.generator.generate(prompts.build_condense_messages(question, history, self.s.answer_lang),
                                          max_tokens=160, temperature=0.0)
        except Exception:   # sin reescritura se busca con la pregunta tal cual
            return question
        lines = [x.strip().strip("\"«»").strip() for x in out.splitlines() if x.strip()]
        return lines[0] if lines else question

    def run(self, question: str, name: str, filters: dict | None, options: dict | None, generate: bool,
            emit: Emit, history: list[dict] | None = None) -> None:
        pipe = self.pipelines[name]
        flt = self.filters(filters)
        with self.lock:
            original, question = question, self.standalone_question(question, history)
            gen = None if (generate and self.generator.available) else NullGenerator("generación desactivada")
            with overrides(pipe, options or {}, generator=gen):
                rec = Recorder(self, pipe, emit)
                emit({"type": "start", "t": 0, "pipeline": name, "question": question,
                      "original": original if question != original else None,
                      "config": self.pipeline_config(name), "llm": self.llm_status() if gen is None else None,
                      "filters": {k: v for k, v in vars(flt).items() if v is not None} if flt else {},
                      "filtered_chunks": int(flt.mask(pipe.index.chunks).sum()) if flt else len(pipe.index)})
                with instrument(pipe, rec):
                    result = pipe.answer(question, flt)
                ranked = sorted(range(len(result.contexts)), key=lambda i: -result.contexts[i].score)
                rank_of = {i: r + 1 for r, i in enumerate(ranked)}
                contexts = []
                for i, c in enumerate(result.contexts):
                    contexts.append({
                        "n": i + 1, "rank": rank_of[i], "chunk_ids": [int(x) for x in c.chunk_ids],
                        "code": c.code.replace("_", "/"), "doc": c.doc_id, "title": c.title, "date": c.date,
                        "organismo": c.organismo, "section": c.section, "url": c.url, "text": c.text,
                        "citation": c.citation(), "score": rounded(c.score),
                        "scores": {k: rounded(v) for k, v in c.scores.items()}})
                messages = None
                if contexts and not result.trace.get("abstain"):
                    messages = prompts.build_messages(question, result.contexts, pipe.answer_lang)
                trace = {k: v for k, v in result.trace.items() if k != "timings"}
                index_name = PIPELINE_INFO[name]["index"]
                emit({"type": "result", "t": rec.now(), "pipeline": name, "question": question, "answer": result.answer,
                      "contexts": contexts, "timings": {k: round(v * 1000, 1) for k, v in result.timings.items()},
                      "total_ms": round(result.total_seconds * 1000, 1), "trace": trace, "messages": messages,
                      "query_tokens": rec.query_tokens, "index": index_name,
                      "query_xy": self.project_query(index_name, rec.query_vec),
                      "generated": gen is None,
                      "chunks": rec.meta([cid for c in result.contexts for cid in c.chunk_ids])})

    # ------------------------------------------------------------------ grounding

    def grounding(self, answer: str, contexts: list[str]) -> dict:
        """Para cada frase de la respuesta, la frase del contexto más parecida (coseno de embeddings).

        Es una señal aproximada de fidelidad (faithfulness): una frase sin apoyo cercano en el
        contexto es candidata a alucinación; una cita [n] que no apunta al contexto que la apoya,
        candidata a cita incorrecta.
        """
        sents = [s.strip() for s in _SENT_RE.split(answer or "") if len(s.strip()) > 12]
        ctx_sents, owner = [], []
        for i, text in enumerate(contexts):
            for s in _SENT_RE.split(text):
                s = " ".join(s.split())
                if len(s) > 25:
                    ctx_sents.append(s[:600])
                    owner.append(i + 1)
        if not sents or not ctx_sents:
            return {"sentences": [], "mean": None}
        clean = [_CITE_RE.sub("", s).strip() for s in sents]
        with self.lock:
            a = self.embedder.embed_documents(clean)
            b = self.embedder.embed_documents(ctx_sents)
        sim = np.asarray(a) @ np.asarray(b).T
        out = []
        for i, s in enumerate(sents):
            j = int(sim[i].argmax())
            cites = [int(x) for x in _CITE_RE.findall(s)]
            best_in_cited = None
            if cites:
                mask = np.array([o in cites for o in owner])
                if mask.any():
                    jj = int(np.where(mask, sim[i], -9).argmax())
                    best_in_cited = {"ctx": owner[jj], "sim": rounded(sim[i, jj]), "text": ctx_sents[jj]}
            out.append({"text": s, "cites": cites, "best": {"ctx": owner[j], "sim": rounded(sim[i, j]),
                                                           "text": ctx_sents[j]}, "best_cited": best_in_cited})
        return {"sentences": out, "mean": rounded(float(np.mean([o["best"]["sim"] for o in out])))}

    # ------------------------------------------------------------------ evaluación

    def start_eval(self, kind: str, n: int, names: list[str], custom: list[dict] | None) -> str:
        job_id = f"ev{int(time.time() * 1000) % 10_000_000}"
        job = {"id": job_id, "kind": kind, "status": "running", "done": 0, "total": 0, "message": "Preparando…",
               "summary": None, "detail": None, "error": None, "started": time.time()}
        self.evals[job_id] = job
        threading.Thread(target=self._run_eval, args=(job, kind, n, names, custom), daemon=True).start()
        return job_id

    def _run_eval(self, job: dict, kind: str, n: int, names: list[str], custom: list[dict] | None) -> None:
        try:
            if kind == "titles":
                eval_set = dr.title_queries(self.docs, n=n)
            elif kind == "synthetic":
                if not self.generator.available:
                    raise RuntimeError("Hace falta un LLM conectado para generar preguntas sintéticas.")
                job["message"] = "Generando preguntas con el LLM…"
                with self.lock:
                    eval_set = dr.synthetic_questions(self.generator, self.indexes["advanced"], n=n,
                                                      lang=self.s.answer_lang)
            else:
                eval_set = [q for q in (custom or []) if q.get("question") and q.get("code")]
            if not eval_set:
                raise RuntimeError("El conjunto de evaluación está vacío.")
            pipes = {k: self.pipelines[k] for k in names if k in self.pipelines}
            job.update(total=len(eval_set) * len(pipes), message="Evaluando…",
                       questions=eval_set)
            with self.lock, contextlib.ExitStack() as stack:
                for p in pipes.values():
                    def factory(orig):
                        def f(*a, **kw):
                            out = orig(*a, **kw)
                            job["done"] += 1
                            return out
                        return f
                    stack.enter_context(patched(p, "search", factory))
                summary, detail = dr.evaluate_retrieval(pipes, eval_set, progress=False)
            summary = summary.reset_index()
            job["summary"] = summary.replace({np.nan: None}).to_dict(orient="records")
            detail["rank"] = detail["rank"].astype(object).where(detail["rank"].notna(), None)
            job["detail"] = detail.to_dict(orient="records")
            job.update(status="done", message="Completado", elapsed=round(time.time() - job["started"], 1))
        except Exception as exc:
            traceback.print_exc()
            job.update(status="error", error=f"{type(exc).__name__}: {exc}")
