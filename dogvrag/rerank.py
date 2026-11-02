"""Adapters de reranking."""
from __future__ import annotations

from typing import Protocol

import numpy as np

from .embeddings import resolve_device


class Reranker(Protocol):
    name: str

    def score(self, query: str, texts: list[str]) -> np.ndarray: ...


class CrossEncoderReranker:
    """Cross-encoder de sentence-transformers (bge-reranker-v2-m3, jina-reranker, mMiniLM...).

    Devuelve scores en [0, 1] (sigmoide del logit) para que los umbrales sean comparables.
    """

    def __init__(self, model_name: str = "BAAI/bge-reranker-v2-m3", device: str = "auto",
                 batch_size: int = 16, max_length: int = 512, **model_kwargs):
        from sentence_transformers import CrossEncoder

        self.name = model_name
        self.batch_size = batch_size
        self.model = CrossEncoder(model_name, device=resolve_device(device), max_length=max_length, **model_kwargs)

    def score(self, query: str, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros(0, dtype=np.float32)
        raw = np.asarray(
            self.model.predict([(query, t) for t in texts], batch_size=self.batch_size, show_progress_bar=False),
            dtype=np.float32,
        ).reshape(len(texts), -1)[:, -1]
        if raw.min() < 0.0 or raw.max() > 1.0:  # el modelo devolvió logits
            raw = 1.0 / (1.0 + np.exp(-raw))
        return raw
