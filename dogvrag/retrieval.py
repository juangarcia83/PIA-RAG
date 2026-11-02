"""Retrievers intercambiables (denso, BM25, híbrido con RRF) y filtros por metadatos."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np
import pandas as pd

from .index import ChunkIndex
from .textnorm import fold
from .vectorstore import _topk


@dataclass
class Filters:
    """Prefiltro por metadatos. Las fechas son ISO ("AAAA-MM-DD") e inclusivas."""

    lang: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    year: int | None = None
    organismo: str | None = None     # subcadena, sin distinguir mayúsculas ni acentos
    seccion: str | None = None       # subcadena sobre sección y subsección
    dogv_num: int | None = None
    code: str | None = None          # "1998/4249" o "1998_4249"

    def is_empty(self) -> bool:
        return all(v is None for v in vars(self).values())

    def mask(self, chunks: pd.DataFrame) -> np.ndarray | None:
        if self.is_empty():
            return None
        m = np.ones(len(chunks), dtype=bool)
        if self.lang:
            m &= (chunks["lang"] == self.lang).to_numpy()
        if self.date_from:
            m &= (chunks["date"] >= self.date_from).to_numpy()
        if self.date_to:
            m &= (chunks["date"] <= self.date_to).to_numpy()
        if self.year:
            m &= (chunks["year"] == self.year).to_numpy()
        if self.dogv_num:
            m &= (chunks["dogv_num"] == self.dogv_num).to_numpy()
        if self.code:
            m &= (chunks["code"] == self.code.replace("/", "_")).to_numpy()
        if self.organismo:
            m &= _folded(chunks, "organismo").str.contains(fold(self.organismo), regex=False).to_numpy()
        if self.seccion:
            needle = fold(self.seccion)
            m &= (_folded(chunks, "seccion").str.contains(needle, regex=False)
                  | _folded(chunks, "subseccion").str.contains(needle, regex=False)).to_numpy()
        return m


def _folded(chunks: pd.DataFrame, column: str) -> pd.Series:
    """Columna plegada (minúsculas, sin acentos), calculada una vez y guardada en la tabla."""
    key = f"_{column}_fold"
    if key not in chunks.columns:
        chunks[key] = chunks[column].map(fold)
    return chunks[key]


@dataclass
class Hit:
    chunk_id: int
    score: float
    scores: dict[str, float] = field(default_factory=dict)


class Retriever(Protocol):
    index: ChunkIndex

    def retrieve(self, query: str, k: int = 10, filters: Filters | None = None) -> list[Hit]: ...


def _mask(index: ChunkIndex, filters: Filters | None) -> np.ndarray | None:
    return filters.mask(index.chunks) if filters is not None else None


class DenseRetriever:
    def __init__(self, index: ChunkIndex):
        if index.dense is None or index.embedder is None:
            raise ValueError(f"El índice {index.name!r} no tiene embeddings densos.")
        self.index = index

    def retrieve(self, query: str, k: int = 10, filters: Filters | None = None) -> list[Hit]:
        q = self.index.embedder.embed_queries([query])[0]
        ids, scores = self.index.dense.search(q, k, _mask(self.index, filters))
        return [Hit(int(i), float(s), {"dense": float(s)}) for i, s in zip(ids, scores, strict=True)]


class SparseRetriever:
    def __init__(self, index: ChunkIndex):
        if index.bm25 is None:
            raise ValueError(f"El índice {index.name!r} no tiene BM25.")
        self.index = index

    def retrieve(self, query: str, k: int = 10, filters: Filters | None = None) -> list[Hit]:
        scores = self.index.bm25.scores(query)
        mask = _mask(self.index, filters)
        if mask is not None:
            scores = np.where(mask, scores, 0.0)
        top = _topk(scores, k)
        return [Hit(int(i), float(scores[i]), {"bm25": float(scores[i])}) for i in top if scores[i] > 0]


def rrf_fuse(rankings: list[list[Hit]], k: int, rrf_k: int = 60, weights: list[float] | None = None) -> list[Hit]:
    """Reciprocal Rank Fusion: suma w / (rrf_k + rango) sobre todas las listas."""
    weights = weights or [1.0] * len(rankings)
    fused: dict[int, Hit] = {}
    for ranking, w in zip(rankings, weights, strict=True):
        for rank, hit in enumerate(ranking, start=1):
            f = fused.setdefault(hit.chunk_id, Hit(hit.chunk_id, 0.0, {}))
            f.score += w / (rrf_k + rank)
            for name, value in hit.scores.items():
                f.scores[name] = max(value, f.scores.get(name, float("-inf")))
    out = sorted(fused.values(), key=lambda h: -h.score)[:k]
    for h in out:
        h.scores["rrf"] = h.score
    return out


class HybridRetriever:
    """BM25 + denso fusionados con RRF. Admite varias consultas por rama (multi-query, HyDE)."""

    def __init__(self, index: ChunkIndex, k_each: int = 50, rrf_k: int = 60,
                 dense_weight: float = 1.0, sparse_weight: float = 1.0):
        self.index = index
        self.dense = DenseRetriever(index)
        self.sparse = SparseRetriever(index)
        self.k_each, self.rrf_k = k_each, rrf_k
        self.dense_weight, self.sparse_weight = dense_weight, sparse_weight

    def retrieve(self, query: str, k: int = 10, filters: Filters | None = None) -> list[Hit]:
        return self.retrieve_multi([query], [query], k, filters)

    def retrieve_multi(self, dense_queries: list[str], sparse_queries: list[str], k: int = 10,
                       filters: Filters | None = None) -> list[Hit]:
        rankings, weights = [], []
        for q in dense_queries:
            rankings.append(self.dense.retrieve(q, self.k_each, filters))
            weights.append(self.dense_weight)
        for q in sparse_queries:
            rankings.append(self.sparse.retrieve(q, self.k_each, filters))
            weights.append(self.sparse_weight)
        return rrf_fuse(rankings, k, self.rrf_k, weights)


def dedupe_hits(index: ChunkIndex, hits: list[Hit]) -> list[Hit]:
    """Quita chunks con el mismo texto (duplicados entre disposiciones vecinas o entre versiones)."""
    seen, out = set(), []
    hashes = index.chunks["text_hash"]
    for h in hits:
        key = hashes.iat[h.chunk_id]
        if key not in seen:
            seen.add(key)
            out.append(h)
    return out
