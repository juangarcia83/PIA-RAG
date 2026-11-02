"""Índice de chunks: tabla de chunks + embeddings densos + BM25, con caché en disco reanudable."""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .chunking import Chunker
from .embeddings import Embedder
from .sparse import BM25Index, Tokenizer
from .textnorm import fold
from .types import Document
from .vectorstore import NumpyVectorStore, VectorStore

_LABELS = {"va": ("Títol", "Apartat"), "es": ("Título", "Apartado")}


def make_header(doc: Document, section: str = "", max_title: int = 300) -> str:
    """Cabecera determinista que sitúa el chunk en su disposición (contextual retrieval sin LLM)."""
    d = doc.date
    first = f"DOGV núm. {doc.dogv_num} · {d[8:10]}/{d[5:7]}/{d[:4]}"
    if doc.organismo:
        first += f" · {doc.organismo}"
    lines = [first]
    path = " > ".join(x for x in (doc.seccion, doc.subseccion) if x)
    if path:
        lines.append(path)
    t_label, s_label = _LABELS.get(doc.lang, _LABELS["va"])
    if doc.title:
        title = doc.title if len(doc.title) <= max_title else doc.title[:max_title].rsplit(" ", 1)[0] + "…"
        lines.append(f"{t_label}: {title}")
    if section:
        lines.append(f"{s_label}: {section}")
    return "\n".join(lines)


def build_chunk_table(docs: list[Document], chunker: Chunker, max_chunks_per_doc: int | None = None) -> pd.DataFrame:
    rows = []
    for doc in docs:
        pieces = chunker.split(doc.text)
        if max_chunks_per_doc:
            pieces = pieces[:max_chunks_per_doc]
        for i, p in enumerate(pieces):
            rows.append({
                "doc_id": doc.doc_id, "code": doc.code, "lang": doc.lang, "date": doc.date, "year": doc.year,
                "dogv_num": doc.dogv_num, "title": doc.title, "organismo": doc.organismo,
                "seccion": doc.seccion, "subseccion": doc.subseccion, "url": doc.url,
                "idx": i, "section": p.section, "text": p.text, "header": make_header(doc, p.section),
                "text_hash": hashlib.md5(" ".join(fold(p.text).split()).encode()).hexdigest()[:16],
            })
    df = pd.DataFrame(rows)
    df.index.name = "chunk_id"
    return df


def _fingerprint(chunks: pd.DataFrame, chunker: Chunker, embedder_name: str, contextual: bool) -> str:
    h = hashlib.sha1()
    h.update(json.dumps({"chunker": chunker.config(), "embedder": embedder_name, "contextual": contextual,
                         "n": len(chunks)}, sort_keys=True).encode())
    h.update("".join(chunks["text_hash"]).encode())
    h.update("".join(chunks["doc_id"].unique()).encode())
    return h.hexdigest()[:12]


def _embed_resumable(embedder: Embedder, texts: list[str], out: Path, block: int = 256) -> np.ndarray:
    """Calcula embeddings por bloques sobre un .npy en disco; si se interrumpe, continúa donde se quedó."""
    prog = out.with_suffix(".progress.json")
    n, dim = len(texts), embedder.dim
    done = 0
    if out.exists() and prog.exists():
        state = json.loads(prog.read_text(encoding="utf-8"))
        if state.get("n") == n and state.get("dim") == dim:
            done = int(state.get("done", 0))
    if done >= n:
        return np.load(out)
    if done == 0:
        mm = np.lib.format.open_memmap(out, mode="w+", dtype=np.float32, shape=(n, dim))
    else:
        mm = np.lib.format.open_memmap(out, mode="r+")

    try:
        from tqdm.auto import tqdm

        bar = tqdm(total=n, initial=done, desc=f"Embeddings ({embedder.name})", unit="chunk")
    except ImportError:
        bar = None
    try:
        for start in range(done, n, block):
            end = min(n, start + block)
            mm[start:end] = embedder.embed_documents(texts[start:end])
            mm.flush()
            prog.write_text(json.dumps({"n": n, "dim": dim, "done": end}), encoding="utf-8")
            if bar:
                bar.update(end - start)
    finally:  # suelta el fichero aunque se interrumpa (en Windows un memmap abierto lo bloquea)
        if bar:
            bar.close()
        mm.flush()
        del mm
    return np.load(out)


@dataclass
class ChunkIndex:
    name: str
    chunks: pd.DataFrame
    embedder: Embedder | None = None
    dense: VectorStore | None = None
    bm25: BM25Index | None = None
    contextual: bool = True
    path: Path | None = None

    def __len__(self) -> int:
        return len(self.chunks)

    def index_texts(self) -> list[str]:
        if self.contextual:
            return (self.chunks["header"] + "\n\n" + self.chunks["text"]).tolist()
        return self.chunks["text"].tolist()

    def describe(self) -> str:
        c = self.chunks
        lens = c["text"].str.len()
        return (f"[{self.name}] {len(c)} chunks de {c['doc_id'].nunique()} disposiciones | "
                f"longitud mediana {int(lens.median())} caracteres (p95 {int(lens.quantile(0.95))}) | "
                f"denso: {'sí' if self.dense is not None else 'no'} | BM25: {'sí' if self.bm25 is not None else 'no'}")


def build_index(
    name: str,
    docs: list[Document],
    chunker: Chunker,
    embedder: Embedder | None,
    cache_dir: str | Path,
    contextual: bool = True,
    with_bm25: bool = True,
    bm25_tokenizer: Tokenizer | None = None,
    max_chunks_per_doc: int | None = None,
    store_factory=NumpyVectorStore,
    verbose: bool = True,
) -> ChunkIndex:
    """Trocea, indexa y cachea. Si ya existe un índice con la misma configuración y contenido, lo reutiliza."""
    t0 = time.time()
    chunks = build_chunk_table(docs, chunker, max_chunks_per_doc)
    if chunks.empty:
        raise ValueError("No se ha generado ningún chunk: ¿hay documentos cargados?")
    emb_name = embedder.name if embedder is not None else "none"
    fp = _fingerprint(chunks, chunker, emb_name, contextual)
    path = Path(cache_dir) / f"{name}-{fp}"
    path.mkdir(parents=True, exist_ok=True)
    index = ChunkIndex(name=name, chunks=chunks, embedder=embedder, contextual=contextual, path=path)
    texts = index.index_texts()

    if embedder is not None:
        emb = _embed_resumable(embedder, texts, path / "embeddings.npy")
        index.dense = store_factory(emb)

    if with_bm25:
        bm25 = BM25Index(bm25_tokenizer)
        bm25_dir = path / "bm25"
        loaded = False
        if (bm25_dir / "params.index.json").exists():
            try:
                bm25.load(bm25_dir)
                loaded = bm25.size == len(chunks)
            except Exception:
                loaded = False
        if not loaded:
            bm25.build(texts, show_progress=verbose)
            bm25.save(bm25_dir)
        index.bm25 = bm25

    (path / "manifest.json").write_text(json.dumps({
        "name": name, "fingerprint": fp, "chunker": chunker.config(), "embedder": emb_name,
        "contextual": contextual, "n_chunks": len(chunks), "n_docs": int(chunks["doc_id"].nunique()),
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    if verbose:
        print(f"{index.describe()} | {time.time() - t0:.1f}s | caché: {path}")
    return index
