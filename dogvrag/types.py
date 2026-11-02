"""Tipos de datos básicos del paquete."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Document:
    """Una disposición del DOGV en un idioma."""

    doc_id: str          # "<code>:<lang>", p. ej. "1998_4249:va"
    code: str            # código de inserción con guion bajo, p. ej. "1998_4249"
    lang: str            # "va" | "es"
    date: str            # fecha de publicación ISO, "1998-06-15"
    dogv_num: int
    text: str
    title: str = ""
    title_alt: str = ""  # título oficial en el otro idioma (útil para evaluación cross-lingual)
    organismo: str = ""
    seccion: str = ""
    subseccion: str = ""
    url: str = ""
    path: str = ""
    trim: str = "none"   # cómo se recortó al texto propio: "marker" | "title" | "none"

    @property
    def year(self) -> int:
        return int(self.date[:4])


@dataclass
class Context:
    """Fragmento que se pasa al LLM (uno o varios chunks contiguos de la misma disposición)."""

    chunk_ids: list[int]
    doc_id: str
    code: str
    lang: str
    date: str
    dogv_num: int
    title: str
    organismo: str
    section: str
    url: str
    text: str
    score: float = 0.0                  # score que ordenó el contexto (rerank si existe; si no, fusión/denso)
    scores: dict[str, float] = field(default_factory=dict)

    def citation(self) -> str:
        d = self.date
        date = f"{d[8:10]}/{d[5:7]}/{d[:4]}" if len(d) == 10 else d
        return f"DOGV núm. {self.dogv_num}, {date} [{self.code.replace('_', '/')}]"


@dataclass
class RAGResult:
    pipeline: str
    question: str
    answer: str
    contexts: list[Context]
    timings: dict[str, float] = field(default_factory=dict)
    trace: dict[str, Any] = field(default_factory=dict)

    @property
    def total_seconds(self) -> float:
        return float(sum(self.timings.values()))
