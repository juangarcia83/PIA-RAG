"""Retrieval léxico: tokenizer para valenciano/castellano y adapter de BM25 (bm25s)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .textnorm import word_tokens

# palabras vacías frecuentes (plegadas: sin acentos, minúsculas) en valenciano y castellano
STOPWORDS = frozenset("""
a al als amb aquell aquella aquelles aquells aquest aquesta aquestes aquests aquesta aixo com d da de del dels des
el ela els em en ens entre era es esta estan este esta esto et ha han hi i ja l la les li lo los m me mes mi n ne
ni no o on per pel pels pero perque que qui s sa se sens sense ser seu seua seues seus si sobre son t te tu u un
una unes uns us va y como con cual cuando donde e esa ese eso esos esas las le les mas nos para por se sin su sus
una uno unos unas ya han he ha fue es son sera sido este estos estas del lo al
""".split())


class Tokenizer:
    """Minúsculas, sin acentos, sin stopwords y con stemming opcional (Snowball catalán o español)."""

    def __init__(self, stem: str | None = "auto", lang: str = "va"):
        self._stem = None
        self._cache: dict[str, str] = {}
        self.stem_name = "none"
        if stem in ("auto", True, "snowball"):
            try:
                import snowballstemmer

                self.stem_name = "catalan" if lang == "va" else "spanish"
                self._stem = snowballstemmer.stemmer(self.stem_name).stemWord
            except ImportError:
                if stem != "auto":
                    raise

    def __call__(self, text: str) -> list[str]:
        out = []
        for tok in word_tokens(text):
            if tok in STOPWORDS or (len(tok) < 2 and not tok.isdigit()):
                continue
            if self._stem and tok.isalpha() and len(tok) > 3:
                stemmed = self._cache.get(tok)
                if stemmed is None:
                    stemmed = self._cache[tok] = self._stem(tok)
                tok = stemmed
            out.append(tok)
        return out


class BM25Index:
    """BM25 sobre bm25s. `scores(query)` devuelve el score de todos los chunks (permite prefiltrar)."""

    def __init__(self, tokenizer: Tokenizer | None = None, k1: float = 1.2, b: float = 0.75):
        self.tokenizer = tokenizer or Tokenizer()
        self.k1, self.b = k1, b
        self._bm25 = None

    def build(self, texts: list[str], show_progress: bool = True) -> BM25Index:
        import bm25s

        iterator = texts
        if show_progress:
            try:
                from tqdm.auto import tqdm

                iterator = tqdm(texts, desc="Tokenizando (BM25)", unit="chunk")
            except ImportError:
                pass
        tokens = [self.tokenizer(t) or ["__vacio__"] for t in iterator]
        self._bm25 = bm25s.BM25(method="lucene", k1=self.k1, b=self.b)
        self._bm25.index(tokens, show_progress=False)
        return self

    def scores(self, query: str) -> np.ndarray:
        toks = self.tokenizer(query)
        if not toks:
            return np.zeros(self.size, dtype=np.float32)
        return np.asarray(self._bm25.get_scores(toks), dtype=np.float32)

    @property
    def size(self) -> int:
        return int(self._bm25.scores["num_docs"])

    def save(self, path: str | Path) -> None:
        self._bm25.save(str(path), show_progress=False)

    def load(self, path: str | Path) -> BM25Index:
        import bm25s

        self._bm25 = bm25s.BM25.load(str(path), show_progress=False)
        return self
