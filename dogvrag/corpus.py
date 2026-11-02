"""Carga del corpus DOGV desde la estructura en disco.

Estructura esperada (la de DOGV_CORPUS)::

    <root>/processed/markdown/<AAAA>/<MM>/<DD>/DOGV_<n>/<variant>/<lang>/<fecha>__DOGV_<n>__<código>__<hash>.md
    <root>/processed/markdown/<AAAA>/<MM>/<DD>/DOGV_<n>/es_va/<mismo nombre>.meta.json
    <root>/metadata/api/DOGV_<n>_<lang>.json

`variant` es "deepseek" (Markdown corregido) o "" para usar directamente `es/` y `va/`.
"""
from __future__ import annotations

import json
import os
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .cleaning import clean_markdown, title_tokens, trim_to_own
from .types import Document

FNAME_RE = re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})__DOGV_(?P<num>\d+)__(?P<code>.+?)__(?P<hash>[0-9a-fA-F]+)\.md$")


@dataclass
class CorpusConfig:
    root: str | Path
    langs: tuple[str, ...] = ("va",)
    variant: str = "deepseek"
    years: tuple[int, ...] | None = None       # None = todos los años disponibles
    date_from: str | None = None               # "AAAA-MM-DD", inclusive
    date_to: str | None = None                 # "AAAA-MM-DD", inclusive
    max_docs: int | None = None                # tope de disposiciones (por idioma se cuentan aparte)
    sample: str = "random"                     # "random" | "first"
    seed: int = 0
    min_chars: int = 80                        # descarta ficheros casi vacíos
    max_chars_per_doc: int | None = None       # trunca disposiciones enormes (listados, anexos)
    trim_to_own: bool = True                   # recorta el texto de disposiciones vecinas

    def markdown_root(self) -> Path:
        root = Path(self.root)
        cand = root / "processed" / "markdown"
        return cand if cand.is_dir() else root

    def metadata_api_dir(self) -> Path:
        return Path(self.root) / "metadata" / "api"


@dataclass
class CorpusStats:
    files_found: int = 0
    loaded: int = 0
    skipped_short: int = 0
    truncated: int = 0
    without_metadata: int = 0
    trim: Counter = field(default_factory=Counter)
    chars_raw: int = 0
    chars_trimmed: int = 0
    by_year: Counter = field(default_factory=Counter)
    by_lang: Counter = field(default_factory=Counter)

    def summary(self) -> str:
        pct = 100 * (1 - self.chars_trimmed / self.chars_raw) if self.chars_raw else 0.0
        trim = ", ".join(f"{k}={v}" for k, v in sorted(self.trim.items())) or "-"
        years = ", ".join(f"{y}: {n}" for y, n in sorted(self.by_year.items()))
        return (
            f"Ficheros encontrados: {self.files_found} | cargados: {self.loaded} "
            f"(descartados por cortos: {self.skipped_short}, truncados: {self.truncated}, "
            f"sin metadatos: {self.without_metadata})\n"
            f"Por idioma: {dict(self.by_lang)}\n"
            f"Por año: {years}\n"
            f"Recorte a la disposición propia: {trim} | texto de disposiciones vecinas eliminado: {pct:.1f}%"
        )


def _subdirs(path: Path, pattern: str) -> list[os.DirEntry]:
    try:
        return sorted((e for e in os.scandir(path) if e.is_dir() and re.fullmatch(pattern, e.name)),
                      key=lambda e: e.name)
    except FileNotFoundError:
        return []


def iter_issue_dirs(cfg: CorpusConfig):
    """Recorre los directorios DOGV_<n> dentro del rango pedido: (fecha ISO, número, ruta)."""
    md_root = cfg.markdown_root()
    for y in _subdirs(md_root, r"\d{4}"):
        if cfg.years and int(y.name) not in cfg.years:
            continue
        for m in _subdirs(Path(y.path), r"\d{2}"):
            for d in _subdirs(Path(m.path), r"\d{2}"):
                date = f"{y.name}-{m.name}-{d.name}"
                if (cfg.date_from and date < cfg.date_from) or (cfg.date_to and date > cfg.date_to):
                    continue
                for issue in _subdirs(Path(d.path), r"DOGV_\d+"):
                    yield date, int(issue.name.split("_")[1]), Path(issue.path)


def list_files(cfg: CorpusConfig) -> list[tuple[Path, str, Path]]:
    """Lista (dir. del número, idioma, fichero .md) sin leer contenido."""
    found = []
    for _date, _num, issue_dir in iter_issue_dirs(cfg):
        for lang in cfg.langs:
            lang_dir = issue_dir / cfg.variant / lang if cfg.variant else issue_dir / lang
            try:
                names = sorted(e.name for e in os.scandir(lang_dir) if e.name.endswith(".md"))
            except FileNotFoundError:
                continue
            found.extend((issue_dir, lang, lang_dir / n) for n in names)
    return found


def _norm_code(codigo: str) -> str:
    return codigo.strip().replace("/", "_")


def _meta_entry(om: dict) -> dict:
    sec = om.get("seccion") or {}
    sub = om.get("subseccion") or {}
    url = om.get("urlPdf") or ""
    return {
        "title": " ".join((om.get("titulo") or "").split()),
        "organismo": " ".join((om.get("organismo") or "").split()),
        "seccion": (sec.get("descripcion") or "").strip(),
        "subseccion": (sub.get("descripcion") or "").strip(),
        "url": f"https://dogv.gva.es/datos{url}" if url.startswith("/") else url,
    }


class IssueMetadata:
    """Metadatos oficiales de un número del DOGV: {idioma: {código: campos}}."""

    def __init__(self, cfg: CorpusConfig, issue_dir: Path, num: int):
        self.by_lang: dict[str, dict[str, dict]] = {}
        api_dir = cfg.metadata_api_dir()
        for lang in ("va", "es"):
            f = api_dir / f"DOGV_{num}_{lang}.json"
            if f.is_file():
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    self.by_lang[lang] = {
                        _norm_code(d.get("codigoInsercion", "")): _meta_entry(d)
                        for d in data.get("disposiciones", [])
                    }
                except (json.JSONDecodeError, OSError):
                    pass
        self._issue_dir = issue_dir
        self._fallback_done = False

    def _load_fallback(self) -> None:
        """Respaldo si falta metadata/api: lee los .meta.json que acompañan al Markdown bilingüe."""
        if self._fallback_done:
            return
        self._fallback_done = True
        meta_dir = self._issue_dir / "es_va"
        try:
            names = [e.name for e in os.scandir(meta_dir) if e.name.endswith(".meta.json")]
        except FileNotFoundError:
            return
        for name in names:
            m = FNAME_RE.match(name.replace(".meta.json", ".md"))
            try:
                data = json.loads((meta_dir / name).read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            for src in data.get("sources", []):
                om = src.get("official_metadata") or {}
                lang, code = src.get("api_language"), _norm_code(om.get("codigoInsercion", ""))
                if lang and code:
                    self.by_lang.setdefault(lang, {}).setdefault(code, _meta_entry(om))
            # el PDF puede agrupar varias inserciones: el código del nombre de fichero también debe resolverse
            if m:
                for lang in {s.get("api_language") for s in data.get("sources", [])} - {None}:
                    first = next(s for s in data["sources"] if s.get("api_language") == lang)
                    self.by_lang.setdefault(lang, {}).setdefault(
                        m.group("code"), _meta_entry(first.get("official_metadata") or {}))

    def get(self, lang: str, code: str) -> dict | None:
        entry = self.by_lang.get(lang, {}).get(code)
        if entry is None and not self._fallback_done:
            self._load_fallback()
            entry = self.by_lang.get(lang, {}).get(code)
        return entry

    def titles(self, lang: str) -> dict[str, str]:
        if lang not in self.by_lang:
            self._load_fallback()
        return {c: e["title"] for c, e in self.by_lang.get(lang, {}).items() if e.get("title")}


def load_documents(cfg: CorpusConfig, progress: bool = True) -> tuple[list[Document], CorpusStats]:
    """Lee, limpia y (opcionalmente) recorta las disposiciones seleccionadas."""
    stats = CorpusStats()
    files = list_files(cfg)
    stats.files_found = len(files)
    if not files:
        raise FileNotFoundError(
            f"No hay ficheros .md en {cfg.markdown_root()} para variant={cfg.variant!r}, langs={cfg.langs}, "
            f"years={cfg.years}. Revisa CORPUS_ROOT y la selección de años."
        )
    if cfg.max_docs and len(files) > cfg.max_docs:
        if cfg.sample == "random":
            files = sorted(random.Random(cfg.seed).sample(files, cfg.max_docs), key=lambda t: str(t[2]))
        else:
            files = files[: cfg.max_docs]

    by_issue: dict[Path, list[tuple[str, Path]]] = defaultdict(list)
    for issue_dir, lang, path in files:
        by_issue[issue_dir].append((lang, path))

    iterator = by_issue.items()
    if progress:
        try:
            from tqdm.auto import tqdm

            iterator = tqdm(iterator, total=len(by_issue), desc="Números del DOGV", unit="núm")
        except ImportError:
            pass

    other_lang = {"va": "es", "es": "va"}
    docs: list[Document] = []
    for issue_dir, items in iterator:
        num = int(issue_dir.name.split("_")[1])
        meta = IssueMetadata(cfg, issue_dir, num)
        title_sets: dict[str, dict[str, frozenset]] = {}
        for lang, path in items:
            m = FNAME_RE.match(path.name)
            if not m:
                continue
            code, date = m.group("code"), m.group("date")
            try:
                raw = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            text = clean_markdown(raw)
            stats.chars_raw += len(text)
            entry = meta.get(lang, code)
            alt = meta.get(other_lang[lang], code) if lang in other_lang else None
            if entry is None:
                stats.without_metadata += 1
                entry = {"title": "", "organismo": "", "seccion": "", "subseccion": "", "url": ""}
            how = "none"
            if cfg.trim_to_own:
                if lang not in title_sets:
                    title_sets[lang] = {c: title_tokens(t) for c, t in meta.titles(lang).items()}
                others = [t for c, t in title_sets[lang].items() if c != code and len(t) >= 4]
                text, how = trim_to_own(text, code, entry["title"], others)
            stats.trim[how] += 1
            stats.chars_trimmed += len(text)
            if len(text) < cfg.min_chars:
                stats.skipped_short += 1
                continue
            if cfg.max_chars_per_doc and len(text) > cfg.max_chars_per_doc:
                text = text[: cfg.max_chars_per_doc].rsplit("\n", 1)[0]
                stats.truncated += 1
            doc = Document(
                doc_id=f"{code}:{lang}", code=code, lang=lang, date=date, dogv_num=num, text=text,
                title=entry["title"], title_alt=(alt or {}).get("title", ""), organismo=entry["organismo"],
                seccion=entry["seccion"], subseccion=entry["subseccion"], url=entry["url"],
                path=str(path), trim=how,
            )
            docs.append(doc)
            stats.by_year[doc.year] += 1
            stats.by_lang[lang] += 1
    stats.loaded = len(docs)
    return docs, stats
