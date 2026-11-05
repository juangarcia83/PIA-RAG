"""Documentos que adjunta el usuario (PDF, DOCX, TXT/MD): conversión a texto, troceado e índice propio en memoria.

- PDF: PyMuPDF4LLM, página a página (Markdown con títulos y tablas; la página sirve para citar).
- DOCX: el XML del documento leído con la biblioteca estándar (párrafos, títulos, listas y tablas en Markdown),
  sin dependencias compiladas.
- TXT/MD: texto tal cual (UTF-8 o, si no lo es, Windows-1252).

Un documento corto (hasta `FULL_CHARS`) entra entero en el prompt, página a página. Uno largo se trocea con el
mismo `StructureChunker` del DOGV y se indexa (BM25 + denso, fusionados con RRF) para recuperar en cada pregunta
solo los fragmentos relevantes. Nada se escribe en disco. Los mensajes de `AttachmentError` se muestran al usuario.
"""
from __future__ import annotations

import io
import re
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

import numpy as np

from .chunking import StructureChunker
from .sparse import BM25Index

MAX_BYTES = 20 * 1024 * 1024          # tamaño máximo del fichero
MAX_PAGES = 100                       # páginas máximas de un PDF
MAX_XML_BYTES = 40 * 1024 * 1024      # document.xml descomprimido (evita bombas zip en DOCX)
MAX_CHARS = 1_500_000                 # texto máximo tras la conversión
FULL_CHARS = 15_000                   # hasta aquí el documento va entero al prompt
TOP_K = 4                             # fragmentos de un documento largo por pregunta
RRF_K = 60
EXTENSIONS = ("pdf", "docx", "txt", "md")

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class AttachmentError(ValueError):
    """Documento no admitido o ilegible; el mensaje es para el usuario."""


# ------------------------------------------------------------------ conversión a texto
def detect_kind(name: str, data: bytes) -> str:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in EXTENSIONS:
        raise AttachmentError("Format no admès: adjunta un PDF, un DOCX o un TXT.")
    # el contenido manda sobre la extensión: un PDF de verdad empieza por %PDF y un DOCX es un ZIP
    if ext == "pdf" and not data.startswith(b"%PDF-"):
        raise AttachmentError("El fitxer no és un PDF vàlid.")
    if ext == "docx" and not data.startswith(b"PK\x03\x04"):
        raise AttachmentError("El fitxer no és un document Word (.docx) vàlid.")
    return "txt" if ext == "md" else ext


def _pdf_pages(data: bytes) -> list[tuple[int | None, str]]:
    import pymupdf
    import pymupdf4llm

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise AttachmentError("No s'ha pogut obrir el PDF.") from exc
    if doc.needs_pass:
        raise AttachmentError("El PDF està protegit amb contrasenya.")
    if doc.page_count > MAX_PAGES:
        raise AttachmentError(f"El PDF té {doc.page_count} pàgines; el màxim és {MAX_PAGES}.")
    chunks = pymupdf4llm.to_markdown(doc, page_chunks=True, show_progress=False)
    return [(c.get("metadata", {}).get("page_number", i + 1), c.get("text", "")) for i, c in enumerate(chunks)]


def _docx_runs(el: ET.Element) -> str:
    out = []
    for node in el.iter():
        if node.tag == f"{_W}t":
            out.append(node.text or "")
        elif node.tag == f"{_W}tab":
            out.append("\t")
        elif node.tag in (f"{_W}br", f"{_W}cr"):
            out.append("\n")
    return "".join(out)


def _docx_paragraph(p: ET.Element) -> str:
    text = _docx_runs(p).strip()
    if not text:
        return ""
    style = p.find(f"{_W}pPr/{_W}pStyle")
    sid = style.get(f"{_W}val", "") if style is not None else ""
    # estilos de título de Word en inglés, castellano y valenciano (Heading1, Ttulo1, Ttol1…)
    level = re.match(r"(?i)(?:heading|t[íi]?tulo|t[íi]?tol)\s*(\d)", sid)
    if level:
        return "#" * min(int(level.group(1)), 4) + " " + text
    if sid.lower() in ("title", "ttulo", "titulo", "ttol", "titol"):
        return "# " + text
    if p.find(f"{_W}pPr/{_W}numPr") is not None:
        return "- " + text
    return text


def _docx_table(tbl: ET.Element) -> str:
    rows = [[_docx_runs(tc).strip().replace("\n", " ").replace("|", "\\|") for tc in tr.findall(f"{_W}tc")]
            for tr in tbl.findall(f"{_W}tr")]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    n = max(len(r) for r in rows)
    rows = [r + [""] * (n - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * n]
    return "\n".join(lines + ["| " + " | ".join(r) + " |" for r in rows[1:]])


def _docx_text(data: bytes) -> str:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        info = z.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise AttachmentError("El fitxer no és un document Word (.docx) vàlid.") from exc
    if info.file_size > MAX_XML_BYTES:
        raise AttachmentError("El document Word és massa gran.")
    try:
        body = ET.fromstring(z.read(info)).find(f"{_W}body")
    except ET.ParseError as exc:
        raise AttachmentError("No s'ha pogut llegir el document Word.") from exc
    parts = []
    for el in body if body is not None else []:
        part = _docx_paragraph(el) if el.tag == f"{_W}p" else _docx_table(el) if el.tag == f"{_W}tbl" else ""
        if part:
            parts.append(part)
    return "\n\n".join(parts)


def _plain_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise AttachmentError("No s'ha pogut llegir el text (codificació desconeguda).")


def to_pages(name: str, data: bytes) -> tuple[str, list[tuple[int | None, str]]]:
    """(tipo, [(página o None, texto)]) del documento."""
    if len(data) > MAX_BYTES:
        raise AttachmentError(f"El fitxer supera el màxim de {MAX_BYTES // (1024 * 1024)} MB.")
    kind = detect_kind(name, data)
    pages = _pdf_pages(data) if kind == "pdf" else [(None, _docx_text(data) if kind == "docx" else _plain_text(data))]
    pages = [(n, re.sub(r"\n{3,}", "\n\n", t).strip()) for n, t in pages]
    chars = sum(len(t) for _, t in pages)
    if chars < 20:
        raise AttachmentError("El document no té text que es puga llegir (si és un PDF escanejat, encara no s'admet OCR).")
    if chars > MAX_CHARS:
        raise AttachmentError("El document és massa llarg.")
    return kind, [(n, t) for n, t in pages if t]


# ------------------------------------------------------------------ documento adjunto con su índice
@dataclass
class Attachment:
    name: str
    kind: str
    pages: int | None
    chars: int
    chunks: list[dict]                       # {"text", "page"}
    mode: str                                # "full": entero al prompt · "index": recuperación por pregunta
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created: float = field(default_factory=time.time)
    seconds: float = 0.0                     # tiempo de conversión e indexado
    _emb: np.ndarray | None = None
    _bm25: BM25Index | None = None

    @classmethod
    def from_bytes(cls, name: str, data: bytes, embedder=None) -> Attachment:
        t0 = time.perf_counter()
        kind, pages = to_pages(name, data)
        chars = sum(len(t) for _, t in pages)
        if chars <= FULL_CHARS:
            chunks, mode = [{"text": t, "page": n} for n, t in pages], "full"
        else:
            chunker = StructureChunker()
            chunks = [{"text": p.text, "page": n} for n, t in pages for p in chunker.split(t)]
            mode = "index"
        att = cls(name=name, kind=kind, pages=len(pages) if kind == "pdf" else None, chars=chars, chunks=chunks, mode=mode)
        if mode == "index" and embedder is not None:
            att.build_index(embedder)
        att.seconds = round(time.perf_counter() - t0, 2)
        return att

    def build_index(self, embedder) -> None:
        texts = [c["text"] for c in self.chunks]
        self._emb = embedder.embed_documents(texts)
        self._bm25 = BM25Index().build(texts, show_progress=False)

    def info(self) -> dict:
        return {"id": self.id, "name": self.name, "kind": self.kind, "pages": self.pages, "chars": self.chars,
                "chunks": len(self.chunks), "mode": self.mode, "seconds": self.seconds}

    def select(self, question: str, embedder=None, k: int = TOP_K) -> list[dict]:
        """Fragmentos que van al prompt: todos si es corto; si es largo, los k mejores por RRF (BM25 + denso)."""
        if self.mode == "full" or len(self.chunks) <= k:
            return self.chunks
        rankings = []
        if self._emb is not None and embedder is not None:
            q = embedder.embed_queries([question])[0]
            rankings.append(np.argsort(-(self._emb @ q)))
        if self._bm25 is not None:
            scores = self._bm25.scores(question)
            if scores.any():
                rankings.append(np.argsort(-scores))
        if not rankings:
            return self.chunks[:k]
        fused = np.zeros(len(self.chunks))
        for order in rankings:
            fused[order] += 1.0 / (RRF_K + np.arange(1, len(order) + 1))
        best = np.argsort(-fused)[:k]
        return [self.chunks[i] for i in sorted(best)]   # en el orden del documento


def attachment_blocks(attachments: list[Attachment], question: str, embedder=None) -> list[dict]:
    """Bloques de los adjuntos para el prompt y la interfaz, numerados D1, D2… entre todos los documentos."""
    blocks = []
    for att in attachments:
        for c in att.select(question, embedder):
            blocks.append({"ref": f"D{len(blocks) + 1}", "name": att.name, "page": c["page"], "text": c["text"],
                           "attachment": att.id})
    return blocks
