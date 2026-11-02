"""Adapters de embeddings. Cualquier objeto con esta interfaz sirve como `Embedder`."""
from __future__ import annotations

import hashlib
from typing import Protocol

import numpy as np

from .textnorm import word_tokens


class Embedder(Protocol):
    name: str
    dim: int

    def embed_documents(self, texts: list[str], show_progress: bool = False) -> np.ndarray: ...

    def embed_queries(self, texts: list[str]) -> np.ndarray: ...


def resolve_device(device: str = "auto") -> str:
    if device != "auto":
        return device
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


# prefijos que algunos modelos necesitan para distinguir consulta y pasaje
_PREFIXES = {
    "e5": ("query: ", "passage: "),
}


def _default_prefixes(model_name: str) -> tuple[str, str]:
    low = model_name.lower()
    if "e5" in low and "instruct" not in low:
        return _PREFIXES["e5"]
    return "", ""


class SentenceTransformerEmbedder:
    """Cualquier bi-encoder compatible con sentence-transformers (BGE-M3, multilingual-e5, Qwen3-Embedding...)."""

    def __init__(
        self,
        model_name: str = "BAAI/bge-m3",
        device: str = "auto",
        batch_size: int = 32,
        max_seq_length: int | None = 512,
        query_prefix: str | None = None,
        doc_prefix: str | None = None,
        **model_kwargs,
    ):
        from sentence_transformers import SentenceTransformer

        self.name = model_name
        self.device = resolve_device(device)
        self.batch_size = batch_size
        self.model = SentenceTransformer(model_name, device=self.device, **model_kwargs)
        if max_seq_length:
            self.model.max_seq_length = min(max_seq_length, self.model.max_seq_length or max_seq_length)
        q, d = _default_prefixes(model_name)
        self.query_prefix = q if query_prefix is None else query_prefix
        self.doc_prefix = d if doc_prefix is None else doc_prefix
        self.dim = int(self.model.encode(["a"], convert_to_numpy=True).shape[1])

    def _encode(self, texts: list[str], prefix: str, show_progress: bool) -> np.ndarray:
        if prefix:
            texts = [prefix + t for t in texts]
        emb = self.model.encode(
            texts, batch_size=self.batch_size, normalize_embeddings=True,
            convert_to_numpy=True, show_progress_bar=show_progress,
        )
        return np.asarray(emb, dtype=np.float32)

    def embed_documents(self, texts: list[str], show_progress: bool = False) -> np.ndarray:
        return self._encode(texts, self.doc_prefix, show_progress)

    def embed_queries(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts, self.query_prefix, False)


class HashingEmbedder:
    """Embedder sin modelo (hashing de palabras y n-gramas de caracteres).

    Solo para pruebas rápidas del pipeline sin descargar nada: su calidad es la de un
    bag-of-words, no la de un modelo denso.
    """

    def __init__(self, dim: int = 1024):
        self.dim = dim
        self.name = f"hashing-{dim}"

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for tok in word_tokens(text):
            grams = [tok] + [tok[i:i + 4] for i in range(max(1, len(tok) - 3))]
            for g in grams:
                h = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "little")
                v[h % self.dim] += 1.0 if (h >> 63) else -1.0
        n = np.linalg.norm(v)
        return v / n if n else v

    def embed_documents(self, texts: list[str], show_progress: bool = False) -> np.ndarray:
        return np.stack([self._vec(t) for t in texts]) if texts else np.zeros((0, self.dim), np.float32)

    def embed_queries(self, texts: list[str]) -> np.ndarray:
        return self.embed_documents(texts)
