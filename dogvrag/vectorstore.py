"""Almacenes vectoriales. Los embeddings van normalizados, así que producto interno = coseno."""
from __future__ import annotations

from typing import Protocol

import numpy as np


class VectorStore(Protocol):
    def search(self, query: np.ndarray, k: int, mask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]: ...


def _topk(scores: np.ndarray, k: int) -> np.ndarray:
    k = min(k, scores.shape[0])
    if k <= 0:
        return np.empty(0, dtype=np.int64)
    idx = np.argpartition(-scores, k - 1)[:k]
    return idx[np.argsort(-scores[idx], kind="stable")]


class NumpyVectorStore:
    """Búsqueda exacta por fuerza bruta. Suficiente hasta cientos de miles de chunks y admite prefiltrado."""

    def __init__(self, embeddings: np.ndarray):
        self.emb = embeddings

    def search(self, query: np.ndarray, k: int, mask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
        q = np.asarray(query, dtype=np.float32).reshape(-1)
        if mask is not None:
            ids = np.flatnonzero(mask)
            if ids.size == 0:
                return np.empty(0, np.int64), np.empty(0, np.float32)
            scores = self.emb[ids] @ q
            top = _topk(scores, k)
            return ids[top], scores[top]
        scores = self.emb @ q
        top = _topk(scores, k)
        return top, scores[top]
