"""Evaluación de retrieval a nivel de disposición y generación de conjuntos de prueba.

Dos formas de conseguir preguntas con respuesta conocida sin anotar a mano:

- `title_queries`: consulta = título oficial de la disposición en el OTRO idioma (p. ej. título en
  castellano contra un índice en valenciano). No usa LLM. Es un test de humo cross-lingual: favorece a
  los índices que llevan el título en la cabecera del chunk, así que no sirve para sacar conclusiones finas.
- `synthetic_questions`: un LLM escribe una pregunta a partir de un chunk al azar. Más realista, aunque
  conviene revisar una muestra a mano antes de fiarse de los números.
"""
from __future__ import annotations

import random
import time

import pandas as pd

from . import prompts
from .generation import Generator
from .index import ChunkIndex
from .retrieval import Filters
from .types import Document


def title_queries(docs: list[Document], n: int = 50, seed: int = 0, min_len: int = 40) -> list[dict]:
    pool = [d for d in docs if len(d.title_alt) >= min_len]
    rng = random.Random(seed)
    rng.shuffle(pool)
    seen, out = set(), []
    for d in pool:
        if d.title_alt in seen:  # títulos repetidos (p. ej. correcciones de errores) serían ambiguos
            continue
        seen.add(d.title_alt)
        out.append({"question": d.title_alt, "code": d.code})
        if len(out) >= n:
            break
    return out


def synthetic_questions(generator: Generator, index: ChunkIndex, n: int = 30, lang: str = "va", seed: int = 0,
                        min_chars: int = 400) -> list[dict]:
    if not generator.available:
        raise RuntimeError("Hace falta un LLM conectado para generar preguntas sintéticas.")
    c = index.chunks
    pool = c.index[c["text"].str.len() >= min_chars].tolist()
    picked = random.Random(seed).sample(pool, min(n, len(pool)))
    out = []
    for cid in picked:
        row = c.iloc[cid]
        prompt = prompts.QUESTION_GEN[lang if lang in prompts.QUESTION_GEN else "va"].format(
            text=f"{row['header']}\n\n{row['text'][:2500]}")
        q = generator.generate([{"role": "user", "content": prompt}], max_tokens=120, temperature=0.4)
        q = q.strip().splitlines()[0].strip(' "«»') if q.strip() else ""
        if len(q) > 15:
            out.append({"question": q, "code": row["code"], "chunk_id": int(cid)})
    return out


def _ranked_codes(pipeline, question: str, filters: Filters | None, k: int) -> list[str]:
    hits, _ = pipeline.search(question, filters, k)
    codes = pipeline.index.chunks["code"]
    ranked: list[str] = []
    for h in hits:
        code = codes.iat[h.chunk_id]
        if code not in ranked:
            ranked.append(code)
    return ranked[:k]


def evaluate_retrieval(pipelines: dict, eval_set: list[dict], ks: tuple[int, ...] = (1, 3, 5, 10),
                       filters: Filters | None = None, progress: bool = True) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Hit@k y MRR por pipeline, contando una disposición como acertada si aparece alguno de sus chunks.

    Devuelve (resumen por pipeline, detalle por pregunta).
    """
    if not eval_set:
        raise ValueError(
            "El conjunto de evaluación está vacío. `title_queries` necesita el título oficial en el otro idioma "
            "(metadata/api o los .meta.json); con preguntas propias, revisa que la lista no esté vacía.")
    kmax = max(ks)
    detail = []
    for name, pipe in pipelines.items():
        iterator = eval_set
        if progress:
            try:
                from tqdm.auto import tqdm

                iterator = tqdm(eval_set, desc=f"Evaluando {name}", unit="pregunta")
            except ImportError:
                pass
        for item in iterator:
            t0 = time.perf_counter()
            ranked = _ranked_codes(pipe, item["question"], filters, kmax)
            secs = time.perf_counter() - t0
            gold = item["code"].replace("/", "_")
            rank = ranked.index(gold) + 1 if gold in ranked else None
            detail.append({"pipeline": name, "question": item["question"], "code": gold, "rank": rank,
                           "seconds": secs})
    detail_df = pd.DataFrame(detail)
    rows = []
    for name, g in detail_df.groupby("pipeline", sort=False):
        row = {"pipeline": name, "n": len(g)}
        for k in ks:
            row[f"hit@{k}"] = float((g["rank"].notna() & (g["rank"] <= k)).mean())
        row[f"MRR@{kmax}"] = float((1.0 / g["rank"]).fillna(0.0).mean())
        row["s/consulta"] = float(g["seconds"].mean())
        rows.append(row)
    return pd.DataFrame(rows).set_index("pipeline").round(3), detail_df
