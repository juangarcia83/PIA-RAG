"""Limpieza del Markdown y recorte de cada fichero a su propia disposición.

Cada PDF del DOGV contiene páginas completas, así que el Markdown de una disposición suele
arrastrar el final de la anterior y el principio de la siguiente (más cabeceras y sumarios).
`trim_to_own` intenta quedarse solo con el texto propio usando:

1. el código de inserción entre corchetes al final del título (``[1998/4249]``), cuando existe;
2. si no, el título oficial de la API (coincidencia aproximada por tokens).
"""
from __future__ import annotations

import re

from .textnorm import word_tokens

_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_EMPTY_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s*(?:[A-Za-z0-9]{1,3}[.)])?\s*[\"']?\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$")
MARKER_RE = re.compile(r"\[\s*(\d{4})\s*/\s*[A-Za-z]?\s*(\d+)\s*\]")
_LEADING_NUM_RE = re.compile(r"^\s*\d{1,5}\s+(?=[^\W\d_])")
_PARA_SPLIT_RE = re.compile(r"\n[ \t]*(?:\n[ \t]*)+")
_DAYS_VA = "Dilluns|Dimarts|Dimecres|Dijous|Divendres|Dissabte|Diumenge"
_MASTHEAD_RE = re.compile(
    rf"^(?:#+\s*)?(?:(?:DIARI OFICIAL\s+)?DE LA GENERALITAT VALENCIANA|(?:{_DAYS_VA}),[^/\n]{{5,40}}/[^/\n]{{5,40}})\s*$"
)


def clean_markdown(text: str) -> str:
    """Quita ruido del OCR/Markdown sin tocar el contenido."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _COMMENT_RE.sub("", text)
    out: list[str] = []
    for line in text.split("\n"):
        line = line.rstrip()
        if line.lstrip().startswith("|"):
            if _TABLE_SEP_RE.match(line):
                line = "|" + "---|" * (line.count("|") - 1)
            else:
                line = re.sub(r"[ \t]{2,}", " ", line)
        elif _EMPTY_ITEM_RE.match(line) or _MASTHEAD_RE.match(line):
            continue
        out.append(line)
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# --------------------------------------------------------------------------- recorte


def _paragraph_spans(text: str) -> list[tuple[int, int]]:
    spans, pos = [], 0
    for m in _PARA_SPLIT_RE.finditer(text):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    return spans


def _is_table(par: str) -> bool:
    return par.lstrip().startswith("|")


def _is_heading(par: str) -> bool:
    lines = [ln for ln in par.split("\n") if ln.strip()]
    return bool(lines) and all(ln.lstrip().startswith("#") for ln in lines)


def title_tokens(title: str) -> frozenset[str]:
    title = MARKER_RE.sub(" ", title)
    return frozenset(t for t in word_tokens(title) if len(t) > 2 or t.isdigit())


def _par_tokens(par: str) -> frozenset[str]:
    par = _LEADING_NUM_RE.sub("", par.lstrip("# "))
    return title_tokens(par)


def _similarity(a: frozenset[str], b: frozenset[str]) -> float:
    """Mínimo de las dos contenciones: exige que título y párrafo sean casi lo mismo."""
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return min(inter / len(a), inter / len(b))


def _split_code(code: str) -> tuple[str, str]:
    year, _, rest = code.partition("_")
    return year, re.sub(r"\D", "", rest).lstrip("0")


def _marker_codes(par: str) -> list[tuple[str, str]]:
    """Códigos entre corchetes que cierran el párrafo (así terminan los títulos del DOGV)."""
    tail_start = max(0, len(par) - 40)
    return [(m.group(1), m.group(2).lstrip("0")) for m in MARKER_RE.finditer(par) if m.end() >= tail_start
            and not par[m.end():].strip(" .\n\t")]


def trim_to_own(
    text: str,
    code: str,
    title: str = "",
    other_titles: list[frozenset[str]] | None = None,
    threshold: float = 0.72,
) -> tuple[str, str]:
    """Devuelve (texto recortado, método) con método en {"marker", "title", "none"}."""
    spans = _paragraph_spans(text)
    if not spans:
        return text, "none"
    pars = [text[a:b] for a, b in spans]
    own = _split_code(code)
    other_titles = other_titles or []

    # candidatos a inicio: (a) párrafo-título que cierra con el código propio; (b) párrafo que coincide
    # con el título oficial y no se parece más al de otra disposición. Gana el primero que aparezca,
    # porque las disposiciones largas repiten su título en las cabeceras de continuación.
    start_i, how = None, "none"
    for i, par in enumerate(pars):
        if not _is_table(par) and own in _marker_codes(par):
            start_i, how = i, "marker"
            break

    own_tt = title_tokens(title)
    if len(own_tt) >= 4 and not any(_similarity(own_tt, t) >= 0.9 for t in other_titles):
        max_len = 2.2 * len(title) + 80
        limit = len(pars) if start_i is None else start_i
        for i in range(limit):
            par = pars[i]
            if _is_table(par) or len(par) > max_len:
                continue
            pt = _par_tokens(par)
            sim = _similarity(own_tt, pt)
            if sim >= threshold and all(_similarity(t, pt) <= sim for t in other_titles):
                start_i, how = i, "title"
                break
    if start_i is None:
        return text, "none"

    # el/los encabezados inmediatamente anteriores (organismo, sección) pertenecen a esta disposición
    first = start_i
    while first > 0 and start_i - first < 3 and _is_heading(pars[first - 1]):
        first -= 1

    # final: primer párrafo posterior que es el título de OTRA disposición
    max_other = 2.2 * max((len(t) for t in other_titles), default=0) * 8 + 200
    end_i = len(pars)
    for j in range(start_i + 1, len(pars)):
        par = pars[j]
        if _is_table(par):
            continue
        codes = _marker_codes(par)
        is_other = bool(codes) and own not in codes
        if not is_other and other_titles and 20 <= len(par) <= max_other:
            pt = _par_tokens(par)
            if len(pt) >= 4:
                best_other = max(_similarity(t, pt) for t in other_titles)
                is_other = best_other >= 0.8 and best_other > _similarity(own_tt, pt)
        if is_other:
            end_i = j
            while end_i - 1 > start_i and _is_heading(pars[end_i - 1]):
                end_i -= 1
            break

    a = spans[first][0]
    b = spans[end_i - 1][1] if end_i > first else spans[first][1]
    trimmed = text[a:b].strip()
    if len(trimmed) < 80:
        return text, "none"
    return trimmed, how
