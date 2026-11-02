"""Estrategias de chunking intercambiables.

- `FixedChunker`: ventanas de tamaño fijo con solapamiento (baseline naive).
- `StructureChunker`: respeta la estructura del Markdown del DOGV (encabezados, artículos,
  disposiciones, anexos, tablas) y anota cada chunk con la sección a la que pertenece.

Los tamaños van en caracteres (aprox. 4 caracteres por token en valenciano/castellano).
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Protocol


@dataclass(frozen=True)
class Piece:
    text: str
    section: str = ""


class Chunker(Protocol):
    name: str

    def split(self, text: str) -> list[Piece]: ...

    def config(self) -> dict: ...


# --------------------------------------------------------------------------- fixed


@dataclass
class FixedChunker:
    size: int = 1200
    overlap: int = 150
    name: str = "fixed"

    def config(self) -> dict:
        return asdict(self)

    def split(self, text: str) -> list[Piece]:
        pieces, n, start = [], len(text), 0
        while start < n:
            end = min(n, start + self.size)
            if end < n:  # corta en un espacio o salto de línea de la segunda mitad de la ventana
                cut = max(text.rfind(" ", start + self.size // 2, end), text.rfind("\n", start + self.size // 2, end))
                if cut > start:
                    end = cut
            piece = text[start:end].strip()
            if piece:
                pieces.append(Piece(piece))
            if end >= n:
                break
            start = max(end - self.overlap, start + 1)
        return pieces


# --------------------------------------------------------------------------- structure-aware

_HEADING_RE = re.compile(r"^#{1,6}\s+(.*\S)\s*$")
_LEGAL_RE = re.compile(
    r"^(?:Art(?:icle|ículo|iculo|\.)\s|Disposici(?:ó|o|ón|on|ons|ones)\s|Cap[ií]t(?:ol|ulo)\s|"
    r"T[ií]t(?:ol|ulo)\s|Secci(?:ó|o|ón|on)\s|Annex(?:os)?\b|Anexo\b|Base\s)",
    re.IGNORECASE,
)
_LABEL_CUT_RE = re.compile(r"\.\s*[—–-]+|[—–]|:\s")
_SENT_RE = re.compile(r"(?<=[.;:!?])\s+|\n")


@dataclass
class _Block:
    kind: str  # "heading" | "table" | "para"
    text: str


def _legal_label(paragraph: str) -> str:
    line = paragraph.lstrip("*_ ").split("\n", 1)[0]
    if not _LEGAL_RE.match(line):
        return ""
    head = _LABEL_CUT_RE.split(line, maxsplit=1)[0]
    return " ".join(head.split()[:4]).rstrip(".,;:")[:80]


def _blocks(text: str) -> list[_Block]:
    lines, blocks, i = text.split("\n"), [], 0
    is_table = lambda ln: ln.lstrip().startswith("|")  # noqa: E731
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
        elif _HEADING_RE.match(ln):
            blocks.append(_Block("heading", ln.strip()))
            i += 1
        elif is_table(ln):
            j = i
            while j < len(lines) and is_table(lines[j]):
                j += 1
            blocks.append(_Block("table", "\n".join(lines[i:j])))
            i = j
        else:
            j = i
            while j < len(lines) and lines[j].strip() and not _HEADING_RE.match(lines[j]) and not is_table(lines[j]):
                j += 1
            blocks.append(_Block("para", "\n".join(lines[i:j])))
            i = j
    return blocks


def _pack(units: list[str], target: int, sep: str, prefix: str = "") -> list[str]:
    out, cur, cur_len = [], [], len(prefix)
    for u in units:
        if cur and cur_len + len(u) + len(sep) > target:
            out.append(prefix + sep.join(cur))
            cur, cur_len = [], len(prefix)
        cur.append(u)
        cur_len += len(u) + len(sep)
    if cur:
        out.append(prefix + sep.join(cur))
    return out


def _split_big(block: _Block, target: int, hard_max: int) -> list[str]:
    if block.kind == "table":
        rows = block.text.split("\n")
        header = ""
        if len(rows) > 2 and set(rows[1].replace("|", "").strip()) <= set("-: "):
            header, rows = "\n".join(rows[:2]) + "\n", rows[2:]
        rows = [r if len(r) <= hard_max else r[:hard_max] for r in rows]
        return _pack(rows, target, "\n", header)
    units: list[str] = []
    for sent in (s for s in _SENT_RE.split(block.text) if s and s.strip()):
        while len(sent) > hard_max:  # frase desmesurada (OCR sin puntuación): corte duro por palabras
            cut = sent.rfind(" ", 0, hard_max)
            cut = cut if cut > hard_max // 2 else hard_max
            units.append(sent[:cut])
            sent = sent[cut:].lstrip()
        units.append(sent)
    return _pack(units, target, " ")


@dataclass
class StructureChunker:
    target: int = 1400     # tamaño al que se cierra un chunk
    max: int = 2200        # tope duro
    min: int = 300         # por debajo de esto no se corta en un límite de sección
    name: str = "structure"

    def config(self) -> dict:
        return asdict(self)

    def split(self, text: str) -> list[Piece]:
        pieces: list[Piece] = []
        cur: list[_Block] = []
        cur_len, cur_section = 0, ""
        heading, legal = "", ""

        def flush() -> list[_Block]:
            nonlocal cur, cur_len
            carry: list[_Block] = []
            while cur and cur[-1].kind == "heading":  # un encabezado nunca se queda colgando al final
                carry.insert(0, cur.pop())
            if cur:
                pieces.append(Piece("\n\n".join(b.text for b in cur), cur_section))
            cur, cur_len = [], 0
            return carry

        def push(b: _Block, section: str) -> None:
            nonlocal cur_len, cur_section
            if not cur:
                cur_section = section
            cur.append(b)
            cur_len += len(b.text) + 2

        for b in _blocks(text):
            boundary = False
            if b.kind == "heading":
                heading, legal, boundary = _HEADING_RE.match(b.text).group(1)[:80], "", True
            elif b.kind == "para":
                label = _legal_label(b.text)
                if label:
                    legal, boundary = label, True
            section = " > ".join(x for x in (heading, legal) if x)

            if cur and ((boundary and cur_len >= self.min) or cur_len + len(b.text) > self.max):
                for c in flush():
                    push(c, section)
            if len(b.text) > self.max:
                carry = flush()
                prefix = "\n\n".join(c.text for c in carry)
                for k, part in enumerate(_split_big(b, self.target, self.max)):
                    pieces.append(Piece(f"{prefix}\n\n{part}" if (k == 0 and prefix) else part, section))
                continue
            push(b, section)
            if cur_len >= self.target and b.kind != "heading":
                for c in flush():
                    push(c, section)
        flush()
        if cur:  # solo quedaban encabezados sueltos al final
            pieces.append(Piece("\n\n".join(b.text for b in cur), cur_section))

        # un último trozo diminuto se une al anterior
        merged: list[Piece] = []
        for p in pieces:
            if merged and len(p.text) < self.min // 2 and len(merged[-1].text) + len(p.text) <= self.max:
                merged[-1] = Piece(merged[-1].text + "\n\n" + p.text, merged[-1].section)
            else:
                merged.append(p)
        return [p for p in merged if len(p.text.strip()) >= 20] or merged[:1]
