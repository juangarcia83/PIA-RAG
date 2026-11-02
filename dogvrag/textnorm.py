"""Normalización de texto compartida por el tokenizer de BM25 y por el recorte de disposiciones."""
from __future__ import annotations

import re
import unicodedata

_TOKEN_RE = re.compile(r"[0-9]+(?:[/.\-][0-9]+)*|[a-z]+")


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def fold(text: str) -> str:
    """Minúsculas, sin acentos y sin punt volat (col·legi -> collegi)."""
    return strip_accents(text).lower().replace("·", "").replace("’", "'")


def word_tokens(text: str) -> list[str]:
    """Tokens alfanuméricos sobre el texto plegado. Conserva códigos tipo 1998/4249 o 98/02/65."""
    return _TOKEN_RE.findall(fold(text))
