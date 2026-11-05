"""Arquitecturas RAG que se comparan en el RAG Lab.

- `NaiveRAG`:      retrieval denso top-k sobre chunks de tamaño fijo -> generación.
- `AdvancedRAG`:   híbrido BM25 + denso (RRF) con prefiltro por metadatos -> reranking con cross-encoder
                   -> expansión a chunks vecinos -> reordenación ("lost in the middle") -> generación con citas.
- `CorrectiveRAG`: AdvancedRAG + evaluador de relevancia (score del reranker). Si el retrieval es flojo,
                   reformula la consulta (multi-query + HyDE) y reintenta; si sigue flojo, se abstiene.
- `AgenticRAG`:    un LLM agente (ReAct) planifica: busca con las consultas y filtros que decide, lee evidencias
                   completas, repite si hace falta y elige qué fragmentos pasan al contexto.

Interfaz común:
- `search(question, filters, k)`  -> (hits ordenados, traza)      # solo retrieval, para evaluar
- `retrieve(question, filters)`   -> (contextos para el LLM, traza)
- `answer(question, filters)`     -> RAGResult
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from . import prompts
from .generation import Generator
from .index import ChunkIndex
from .rerank import Reranker
from .retrieval import DenseRetriever, Filters, Hit, HybridRetriever, dedupe_hits
from .types import Context, RAGResult

# --------------------------------------------------------------------------- utilidades de contexto


def assemble_contexts(index: ChunkIndex, hits: list[Hit], window: int = 0, max_chars: int = 12000,
                      merge_adjacent: bool = True) -> list[Context]:
    """Convierte hits en contextos para el prompt.

    Con `window` > 0 añade los chunks vecinos de la misma disposición (small-to-big). Con
    `merge_adjacent`, los trozos contiguos de una misma disposición se unen en un solo contexto.
    Se respeta el presupuesto total `max_chars` (el primer contexto entra siempre).
    """
    chunks = index.chunks
    doc_ids = chunks["doc_id"].to_numpy()
    n = len(chunks)
    groups: list[dict] = []
    for h in hits:
        doc = doc_ids[h.chunk_id]
        ids = {h.chunk_id}
        for off in range(1, window + 1):
            ids |= {c for c in (h.chunk_id - off, h.chunk_id + off) if 0 <= c < n and doc_ids[c] == doc}
        target = None
        if merge_adjacent:
            for g in groups:
                if g["doc"] == doc and any(c + d in g["ids"] for c in ids for d in (-1, 0, 1)):
                    target = g
                    break
        if target is not None:
            target["ids"] |= ids
        else:
            groups.append({"doc": doc, "ids": ids, "hit": h})

    contexts, used = [], 0
    for g in groups:
        ids = sorted(g["ids"])
        rows = chunks.iloc[ids]
        text = "\n\n".join(rows["text"])
        if contexts and used + len(text) > max_chars:
            continue
        first, h = rows.iloc[0], g["hit"]
        contexts.append(Context(
            chunk_ids=ids, doc_id=first["doc_id"], code=first["code"], lang=first["lang"], date=first["date"],
            dogv_num=int(first["dogv_num"]), title=first["title"], organismo=first["organismo"],
            section=chunks.iloc[h.chunk_id]["section"], url=first["url"], text=text[:max_chars],
            score=h.score, scores=dict(h.scores),
        ))
        used += len(text)
    return contexts


def reorder_lost_in_middle(contexts: list[Context]) -> list[Context]:
    """Coloca los mejores contextos al principio y al final del prompt y los peores en el centro."""
    front, back = [], []
    for i, c in enumerate(contexts):
        (front if i % 2 == 0 else back).append(c)
    return front + back[::-1]


def prefer_one_language(index: ChunkIndex, hits: list[Hit]) -> list[Hit]:
    """Si el índice es bilingüe, de cada disposición conserva solo el idioma de su mejor chunk."""
    codes, langs = index.chunks["code"], index.chunks["lang"]
    best: dict[str, str] = {}
    out = []
    for h in hits:
        code, lang = codes.iat[h.chunk_id], langs.iat[h.chunk_id]
        if best.setdefault(code, lang) == lang:
            out.append(h)
    return out


# --------------------------------------------------------------------------- pipelines


@dataclass
class _Base:
    index: ChunkIndex
    generator: Generator
    name: str = "rag"
    top_k: int = 5
    answer_lang: str = "va"
    max_context_chars: int = 12000
    max_tokens: int = 1000        # la resposta estructurada (Resposta / Detall / Observacions) és més llarga
    temperature: float = 0.1
    # bloques de documentos adjuntos por el usuario (attachments.attachment_blocks) para la consulta en curso
    attachments: list = field(default_factory=list)

    def search(self, question: str, filters: Filters | None = None, k: int | None = None) -> tuple[list[Hit], dict]:
        raise NotImplementedError

    def _contexts(self, hits: list[Hit]) -> list[Context]:
        return assemble_contexts(self.index, hits[: self.top_k], 0, self.max_context_chars, merge_adjacent=False)

    def retrieve(self, question: str, filters: Filters | None = None) -> tuple[list[Context], dict]:
        hits, trace = self.search(question, filters)
        return self._contexts(hits), trace

    def answer(self, question: str, filters: Filters | None = None) -> RAGResult:
        t0 = time.perf_counter()
        contexts, trace = self.retrieve(question, filters)
        timings = dict(trace.pop("timings", None) or {"retrieval": time.perf_counter() - t0})
        t1 = time.perf_counter()
        # con documentos adjuntos se responde aunque el DOGV no tenga nada: la respuesta puede estar en ellos
        if (trace.get("abstain") or not contexts) and not self.attachments:
            answer = prompts.ABSTAIN[self.answer_lang]
        elif not self.generator.available:
            answer = prompts.NO_LLM[self.answer_lang]
        else:
            messages = prompts.build_messages(question, contexts, self.answer_lang, self.attachments)
            answer = self.generator.generate(messages, self.max_tokens, self.temperature)
            answer = answer or "(El LLM ha devuelto una respuesta vacía: prueba a subir max_tokens.)"
        timings["generation"] = time.perf_counter() - t1
        return RAGResult(self.name, question, answer, contexts, timings, trace)


@dataclass
class NaiveRAG(_Base):
    name: str = "naive"

    def __post_init__(self):
        self.retriever = DenseRetriever(self.index)

    def search(self, question: str, filters: Filters | None = None, k: int | None = None) -> tuple[list[Hit], dict]:
        hits = self.retriever.retrieve(question, max(self.top_k, k or 0), filters)
        return hits, {"n_candidates": len(hits)}


@dataclass
class AdvancedRAG(_Base):
    name: str = "advanced"
    reranker: Reranker | None = None
    k_candidates: int = 30        # candidatos que pasan al reranker
    k_each: int = 50              # candidatos por rama (BM25 y denso) antes de fusionar
    window: int = 0               # chunks vecinos que se añaden a cada lado (small-to-big)
    reorder: bool = True
    rerank_with_header: bool = True

    def __post_init__(self):
        self.retriever = HybridRetriever(self.index, k_each=self.k_each)

    def _candidates(self, dense_q: list[str], sparse_q: list[str], filters: Filters | None) -> list[Hit]:
        hits = self.retriever.retrieve_multi(dense_q, sparse_q, self.k_candidates * 2, filters)
        hits = prefer_one_language(self.index, dedupe_hits(self.index, hits))
        return hits[: self.k_candidates]

    def _rerank(self, question: str, hits: list[Hit]) -> list[Hit]:
        if self.reranker is None or not hits:
            return hits
        rows = self.index.chunks.iloc[[h.chunk_id for h in hits]]
        texts = (rows["header"] + "\n\n" + rows["text"]).tolist() if self.rerank_with_header else rows["text"].tolist()
        for h, s in zip(hits, self.reranker.score(question, texts), strict=True):
            h.scores["rerank"] = float(s)
            h.score = float(s)
        return sorted(hits, key=lambda h: -h.score)

    def _contexts(self, hits: list[Hit]) -> list[Context]:
        contexts = assemble_contexts(self.index, hits[: self.top_k], self.window, self.max_context_chars)
        return reorder_lost_in_middle(contexts) if self.reorder else contexts

    def search(self, question: str, filters: Filters | None = None, k: int | None = None) -> tuple[list[Hit], dict]:
        t0 = time.perf_counter()
        hits = self._candidates([question], [question], filters)
        t1 = time.perf_counter()
        hits = self._rerank(question, hits)
        t2 = time.perf_counter()
        return hits, {"n_candidates": len(hits), "timings": {"retrieval": t1 - t0, "rerank": t2 - t1}}


@dataclass
class CorrectiveRAG(AdvancedRAG):
    name: str = "corrective"
    tau_ok: float = 0.5           # score del reranker a partir del cual el retrieval se da por bueno
    tau_abstain: float = 0.05     # por debajo de esto, tras corregir, el sistema se abstiene
    tau_context: float = 0.02     # los contextos por debajo se descartan (siempre se conserva el mejor)
    n_rewrites: int = 3
    use_hyde: bool = True

    def _ask_llm(self, template: dict, **kwargs) -> str:
        prompt = template[self.answer_lang if self.answer_lang in template else "va"].format(**kwargs)
        return self.generator.generate([{"role": "user", "content": prompt}], max_tokens=300, temperature=0.3)

    def _rewrites(self, question: str) -> list[str]:
        raw = self._ask_llm(prompts.REWRITE, n=self.n_rewrites, question=question)
        lines = [ln.strip(" -•*\t").lstrip("0123456789.) ").strip() for ln in raw.splitlines()]
        return [ln for ln in lines if len(ln) > 8][: self.n_rewrites]

    def search(self, question: str, filters: Filters | None = None, k: int | None = None) -> tuple[list[Hit], dict]:
        t0 = time.perf_counter()
        cands = self._candidates([question], [question], filters)
        t_ret = time.perf_counter()
        hits = self._rerank(question, cands)
        best = hits[0].score if hits else 0.0
        t1 = time.perf_counter()
        trace: dict = {"first_pass_best": round(best, 4), "verdict": "correct", "queries": [question]}
        timings = {"retrieval": t_ret - t0, "rerank": t1 - t_ret}

        if self.reranker is None:
            trace["verdict"] = "sin evaluador (falta reranker)"
        elif best < self.tau_ok:
            trace["verdict"] = "ambiguous"
            if self.generator.available:
                rewrites = self._rewrites(question)
                hyde = self._ask_llm(prompts.HYDE, question=question) if self.use_hyde else ""
                trace["queries"] += rewrites
                trace["hyde"] = hyde[:300]
                t2 = time.perf_counter()
                dense_q = [question] + rewrites + ([hyde] if hyde else [])
                more = self._rerank(question, self._candidates(dense_q, [question] + rewrites, filters))
                seen = {h.chunk_id for h in hits}
                hits = sorted(hits + [h for h in more if h.chunk_id not in seen], key=lambda h: -h.score)
                hits = dedupe_hits(self.index, hits)
                timings["query_rewriting"] = t2 - t1
                timings["second_pass"] = time.perf_counter() - t2
            else:
                trace["note"] = "sin LLM no se puede reformular la consulta"
            best = hits[0].score if hits else 0.0
            trace["second_pass_best"] = round(best, 4)
            if best < self.tau_abstain:
                trace["verdict"], trace["abstain"] = "incorrect", True

        if self.reranker is not None and hits:
            hits = [hits[0]] + [h for h in hits[1:] if h.score >= self.tau_context]
        trace["n_candidates"] = len(hits)
        trace["timings"] = timings
        return hits, trace


# --------------------------------------------------------------------------- agentic RAG

_FILTER_KEYS = ("organismo", "seccion", "date_from", "date_to", "dogv_num", "year")
_JSON_RE = re.compile(r"\{.*\}", re.S)


def _parse_action(raw: str) -> dict | None:
    """Primer objeto JSON de la salida del LLM (tolera bloques ```json y texto alrededor)."""
    m = _JSON_RE.search(raw or "")
    if not m:
        return None
    try:
        out = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    return out if isinstance(out, dict) and out.get("action") in ("search", "read", "finish") else None


@dataclass
class AgenticRAG(AdvancedRAG):
    """Agente ReAct: el LLM decide en cada paso si buscar (con otra consulta o con filtros), leer una evidencia
    completa o terminar, y elige qué evidencias pasan al contexto. La respuesta la redacta después el mismo
    prompt que en las demás arquitecturas, así que las diferencias vienen solo de cómo se reúne el contexto.

    Sin LLM no hay agente: se hace una única búsqueda con la pregunta (equivale a AdvancedRAG).
    """

    name: str = "agentic"
    max_steps: int = 4            # decisiones del agente, incluida la de terminar
    n_show: int = 5               # resultados de cada búsqueda que ve el agente
    snippet_chars: int = 360
    read_chars: int = 2400

    def _notify(self, kind: str, ids=(), **data) -> None:
        """Gancho para la web: cada decisión y cada observación del agente. Aquí no hace nada."""

    def _decide(self, messages: list[dict]) -> str:
        return self.generator.generate(messages, max_tokens=400, temperature=0.1)

    def _lang(self) -> str:
        return self.answer_lang if self.answer_lang in prompts.AGENT else "va"

    def _corpus_hint(self, txt: dict) -> str:
        langs = set(self.index.chunks["lang"].unique())
        return txt["corpus_va"] if langs == {"va"} else txt["corpus_es"] if langs == {"es"} else txt["corpus_any"]

    @staticmethod
    def _merge_filters(user: Filters | None, agent: dict | None) -> Filters | None:
        """Los filtros del agente se suman a los del usuario; si chocan, mandan los del usuario."""
        keep: dict = {}
        for k, v in (agent or {}).items():
            if k in _FILTER_KEYS and v not in (None, "", []):
                try:
                    keep[k] = int(v) if k in ("dogv_num", "year") else str(v)
                except (TypeError, ValueError):
                    continue
        if user is not None:
            keep.update({k: v for k, v in vars(user).items() if v is not None})
        return Filters(**keep) if keep else None

    def _run_agent(self, question: str, filters: Filters | None) -> tuple[list[Hit], set[int], dict]:
        lang = self._lang()
        txt = prompts.AGENT_TURN[lang]
        chunks = self.index.chunks
        pool: dict[int, Hit] = {}           # chunk_id -> mejor hit visto
        refs: dict[str, int] = {}           # "E3" -> chunk_id
        ref_of: dict[int, str] = {}
        read: set[int] = set()
        done_queries: set[tuple] = set()
        steps: list[dict] = []
        timings = {"planning": 0.0, "retrieval": 0.0, "rerank": 0.0}
        trace: dict = {"queries": [], "steps": steps}

        def search(query: str, agent_filters: dict | None) -> list[Hit]:
            flt = self._merge_filters(filters, agent_filters)
            t0 = time.perf_counter()
            hits = self._candidates([query], [query], flt)
            t1 = time.perf_counter()
            hits = self._rerank(query, hits)
            timings["retrieval"] += t1 - t0
            timings["rerank"] += time.perf_counter() - t1
            for h in hits:
                if h.chunk_id not in pool or h.score > pool[h.chunk_id].score:
                    pool[h.chunk_id] = h
            return hits

        def ref(cid: int) -> tuple[str, bool]:
            if cid in ref_of:
                return ref_of[cid], False
            r = f"E{len(refs) + 1}"
            refs[r], ref_of[cid] = cid, r
            return r, True

        if not self.generator.available:      # sin LLM: una búsqueda con la pregunta, como AdvancedRAG
            hits = search(question, None)
            trace.update(queries=[question], stop="no_llm", note="sin LLM no hay agente: una única búsqueda")
            trace["timings"] = {k: v for k, v in timings.items() if v}
            return hits, read, trace

        system = prompts.AGENT[lang].format(corpus_hint=self._corpus_hint(txt), top_k=self.top_k,
                                            max_steps=self.max_steps)
        messages = [{"role": "system", "content": system},
                    {"role": "user", "content": txt["question"].format(question=question, max_steps=self.max_steps)}]
        selected: list[str] | None = None
        for step in range(1, self.max_steps + 1):
            t0 = time.perf_counter()
            raw = self._decide(messages)
            timings["planning"] += time.perf_counter() - t0
            action = _parse_action(raw)
            fallback = action is None
            if fallback:                       # salida no válida: se busca con la pregunta o se termina
                action = {"action": "search", "query": question} if not pool else {"action": "finish"}
            if step == self.max_steps and action["action"] != "finish":
                action, fallback = {"action": "finish", "thought": action.get("thought", "")}, True
            kind = action["action"]
            entry = {"step": step, "thought": str(action.get("thought", ""))[:500], "action": kind,
                     "fallback": fallback}
            messages.append({"role": "assistant", "content": json.dumps(action, ensure_ascii=False) if fallback else raw})

            if kind == "finish":
                ev = action.get("evidence")
                selected = [str(r).strip() for r in ev] if isinstance(ev, list) else None
                entry["evidence"] = selected
                steps.append(entry)
                self._notify("agent_plan", **entry, max_steps=self.max_steps)
                break

            if kind == "search":
                query = " ".join(str(action.get("query") or question).split())[:300]
                raw_filters = action.get("filters") if isinstance(action.get("filters"), dict) else {}
                agent_filters = {k: v for k, v in raw_filters.items() if k in _FILTER_KEYS and v not in (None, "", [])}
                entry.update(query=query, filters=agent_filters)
                self._notify("agent_plan", **entry, max_steps=self.max_steps)
                key = (query.lower(), json.dumps(agent_filters, sort_keys=True, ensure_ascii=False))
                ftxt = f" [{', '.join(f'{k}={v}' for k, v in agent_filters.items())}]" if agent_filters else ""
                results: list[dict] = []
                duplicate = key in done_queries
                if duplicate:
                    obs = txt["duplicate"]
                else:
                    done_queries.add(key)
                    trace["queries"].append(query)
                    hits = search(query, agent_filters)[: self.n_show]
                    lines = []
                    for h in hits:
                        r, new = ref(h.chunk_id)
                        row = chunks.iloc[h.chunk_id]
                        results.append({"ref": r, "id": int(h.chunk_id), "s": round(float(h.score), 4), "new": new})
                        cite = f"DOGV núm. {row['dogv_num']}, {row['date']} [{row['code'].replace('_', '/')}]"
                        snippet = " ".join(str(row["text"]).split())[: self.snippet_chars]
                        seen = "" if new else " " + txt["seen"]
                        lines.append(f"{r} · score {h.score:.3f} · {cite} · {row['organismo']}{seen}\n"
                                     f"   {str(row['title'])[:220]}\n   «{snippet}…»")
                    obs = (txt["results"].format(query=query, filters=ftxt, n=len(hits)) + "\n\n" + "\n\n".join(lines)
                           if hits else txt["no_results"].format(query=query, filters=ftxt))
                entry["results"] = results
                self._notify("agent_obs", [x["id"] for x in results], step=step, action=kind, query=query,
                             results=results, duplicate=duplicate)
            else:                               # read
                r = str(action.get("ref", "")).strip().upper()
                entry["ref"] = r
                self._notify("agent_plan", **entry, max_steps=self.max_steps)
                if r not in refs:
                    obs = txt["bad_ref"].format(ref=r, refs=", ".join(refs) or "—")
                    self._notify("agent_obs", step=step, action=kind, ref=r, ok=False)
                else:
                    cid = refs[r]
                    read.add(cid)
                    ctx = assemble_contexts(self.index, [pool[cid]], 1, self.read_chars)[0]
                    obs = txt["read"].format(ref=r, citation=ctx.citation(), title=ctx.title[:300],
                                             text=ctx.text[: self.read_chars])
                    entry["chars"] = len(ctx.text)
                    self._notify("agent_obs", ctx.chunk_ids, step=step, action=kind, ref=r, ok=True, id=int(cid),
                                 chunk_ids=[int(c) for c in ctx.chunk_ids], chars=len(ctx.text))
            steps.append(entry)
            nxt = txt["last"] if step + 1 == self.max_steps else txt["next"]
            messages.append({"role": "user", "content": obs + "\n\n" + nxt.format(step=step + 1, max_steps=self.max_steps,
                                                                                n=len(refs))})

        # evidencias: las que elige el agente (en su orden); si no termina o no elige, las mejores por score
        ranked = sorted(pool.values(), key=lambda h: -h.score)
        if selected is not None:
            chosen = [pool[refs[r]] for r in dict.fromkeys(x.upper() for x in selected) if r in refs]
            trace["stop"] = "finish"
            if not chosen:
                trace["abstain"] = True
        else:
            chosen = ranked[: self.top_k]
            trace["stop"] = "max_steps"
        chosen = chosen[: self.top_k]
        trace["selected"] = [ref_of[h.chunk_id] for h in chosen]
        trace["n_evidence"] = len(pool)
        self._notify("agent_done", [h.chunk_id for h in chosen], stop=trace["stop"], n_pool=len(pool),
                     evidence=[{"ref": ref_of[h.chunk_id], "id": int(h.chunk_id), "s": round(float(h.score), 4)}
                               for h in chosen], abstain=bool(trace.get("abstain")))
        rest = [h for h in ranked if h not in chosen]
        trace["timings"] = {k: v for k, v in timings.items() if v}
        return chosen + rest, read, trace

    def search(self, question: str, filters: Filters | None = None, k: int | None = None) -> tuple[list[Hit], dict]:
        hits, _, trace = self._run_agent(question, filters)
        trace["n_candidates"] = len(hits)
        return hits, trace

    def retrieve(self, question: str, filters: Filters | None = None) -> tuple[list[Context], dict]:
        hits, read, trace = self._run_agent(question, filters)
        trace["n_candidates"] = len(hits)
        if trace.get("abstain"):
            return [], trace
        n = len(trace.get("selected") or []) or self.top_k
        doc_ids = self.index.chunks["doc_id"].to_numpy()
        top: list[Hit] = []
        for h in hits[:n]:
            top.append(h)
            if h.chunk_id in read:             # lo que el agente ha leído entero entra con sus vecinos
                top += [Hit(c, h.score, dict(h.scores)) for c in (h.chunk_id - 1, h.chunk_id + 1)
                        if 0 <= c < len(doc_ids) and doc_ids[c] == doc_ids[h.chunk_id]]
        contexts = assemble_contexts(self.index, top, self.window, self.max_context_chars)
        return (reorder_lost_in_middle(contexts) if self.reorder else contexts), trace
