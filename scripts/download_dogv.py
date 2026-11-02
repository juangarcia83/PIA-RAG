"""Descarga una muestra reciente del DOGV con la misma estructura que DOGV_CORPUS.

Usa la API pública del portal (https://dogv.gva.es/dogv-portal) para leer el sumario de cada número,
descarga el PDF de cada disposición en valenciano y castellano y lo convierte a Markdown con PyMuPDF.

Estructura que genera (la que espera `dogvrag.load_documents`)::

    <out>/metadata/api/DOGV_<n>_<lang>.json
    <out>/processed/markdown/<AAAA>/<MM>/<DD>/DOGV_<n>/<variant>/<lang>/<fecha>__DOGV_<n>__<código>__<hash>.md
    <out>/raw/pdf/<AAAA>/<MM>/<DD>/<código>_<lang>.pdf

Uso::

    python scripts/download_dogv.py --issues 5 --per-issue 40
    python scripts/download_dogv.py --date 2026-09-15 --issues 3 --langs va
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

API = "https://dogv.gva.es/dogv-portal"
PDF_BASE = "https://dogv.gva.es/datos"
API_LANG = {"va": "es_ca", "es": "es_es"}
HEADERS = {"User-Agent": "rag_dogv_lab/1.0 (investigación académica; descarga de muestra)",
           "Accept": "application/json"}


# --------------------------------------------------------------------------- API


def _get_json(session: requests.Session, path: str, **params) -> dict:
    r = session.get(f"{API}{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def latest_date(session: requests.Session) -> str:
    data = _get_json(session, "/dogv/latest", lang=API_LANG["va"])
    d = data["disposiciones"][0]["fechaPublicacion"]          # "07/10/2026"
    return f"{d[6:10]}-{d[3:5]}-{d[0:2]}"


def issue(session: requests.Session, date: str, lang: str) -> dict:
    return _get_json(session, "/dogv", date=date, lang=API_LANG[lang])


def previous_date(session: requests.Session, date: str) -> str | None:
    data = _get_json(session, "/dogv/anteriorYSiguiente", date=date, lang=API_LANG["va"])
    return data.get("fechaDogvAnterior")


# --------------------------------------------------------------------------- PDF -> Markdown

_RUNNING_RE = re.compile(r"^(Núm\.\s*\d+\s*/\s*\d{2}\.\d{2}\.\d{4}|\d+\s*/\s*\d+|CVE:\s*DOGV-.*|https?://dogv\.gva\.es/?)$")


def pdf_to_markdown(pdf: bytes, max_pages: int | None = None) -> str:
    """Texto de un PDF del DOGV en Markdown sencillo: párrafos reconstruidos y encabezados centrados.

    El DOGV maqueta a una columna: la primera línea de cada párrafo va sangrada y los encabezados
    (sección, organismo, «PREÀMBUL», «ANNEX»...) van centrados. Se quitan cabeceras y pies de página.
    """
    import pymupdf

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    lines = []      # (página, x0, y0, x1, texto, negrita, cursiva, tamaño)
    for pno, page in enumerate(doc):
        if max_pages and pno >= max_pages:
            break
        width = page.rect.width
        for block in page.get_text("dict")["blocks"]:
            for ln in block.get("lines", []):
                spans = [s for s in ln["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = " ".join("".join(s["text"] for s in ln["spans"]).split())
                x0, y0, x1, _ = ln["bbox"]
                if (y0 < 75 or y0 > page.rect.height - 45) and _RUNNING_RE.match(text):
                    continue
                font = spans[0]["font"]
                lines.append((pno, x0, y0, x1, text, "Bold" in font, "Italic" in font, spans[0]["size"], width))
    doc.close()
    if not lines:
        return ""

    # margen izquierdo del cuerpo: la x más pequeña que se repite (la moda puede ser la sangría si hay índices)
    xs = Counter(round(ln[1]) for ln in lines)
    frequent = [x for x, c in xs.items() if c >= max(3, 0.05 * len(lines))]
    left = min(frequent) if frequent else xs.most_common(1)[0][0]
    paras: list[list] = []
    prev = None
    for pno, x0, y0, x1, text, bold, _italic, size, width in lines:
        centered = x0 > left + 40 and abs((x0 + x1) / 2 - width / 2) < 40 and (x1 - x0) < width * 0.6
        indented = left + 15 < x0 < left + 60
        new = (prev is None or centered or prev["centered"] or indented
               or pno != prev["page"] and x0 > left + 15
               or pno == prev["page"] and y0 - prev["y"] > size * 2.1
               or bold != prev["bold"] and not prev["text"].endswith(","))
        if new:
            paras.append([])
        paras[-1].append(text)
        prev = {"page": pno, "y": y0, "centered": centered, "bold": bold, "text": text}
        if centered or bold:
            paras[-1].append("\u0000H")                          # marca de encabezado

    out = []
    for p in paras:
        heading = "\u0000H" in p
        words = [t for t in p if t != "\u0000H"]
        text = ""
        for t in words:                                          # une guiones de fin de línea
            if text.endswith("-") and t[:1].islower():
                text = text[:-1] + t
            else:
                text = f"{text} {t}" if text else t
        if not text:
            continue
        if heading and len(text) < 160:
            out.append(f"## {text}")
        else:
            out.append(text)
    return "\n\n".join(out) + "\n"


def _norm(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def mark_title(md: str, disp: dict) -> str:
    """Cierra el párrafo del título con el código de inserción, como en el Markdown de DOGV_CORPUS.

    Así `trim_to_own` reconoce el inicio de la disposición por la vía "marker". Si el título no
    aparece en el texto extraído, se antepone el título oficial.
    """
    title = " ".join((disp.get("titulo") or "").split())
    marker = f"[{disp['codigoInsercion']}]"
    probe = _norm(title)[:80]
    paras = md.split("\n\n")
    for i, p in enumerate(paras):
        if probe and _norm(p.lstrip("# ")).startswith(probe):
            paras[i] = f"{p.rstrip()} {marker}"
            return "\n\n".join(paras)
    return f"{title} {marker}\n\n{md}"


# --------------------------------------------------------------------------- descarga


def _sample(dispos: list[dict], n: int | None, seed: int) -> list[dict]:
    """Muestra estratificada por sección para no quedarse solo con la primera parte del sumario."""
    if not n or len(dispos) <= n:
        return dispos
    rng = random.Random(seed)
    by_sec: dict[str, list[dict]] = {}
    for d in dispos:
        by_sec.setdefault((d.get("seccion") or {}).get("descripcion", ""), []).append(d)
    for v in by_sec.values():
        rng.shuffle(v)
    picked, pools = [], list(by_sec.values())
    while len(picked) < n and any(pools):
        for pool in pools:
            if pool and len(picked) < n:
                picked.append(pool.pop())
    order = {d["codigoInsercion"]: i for i, d in enumerate(dispos)}
    return sorted(picked, key=lambda d: order[d["codigoInsercion"]])


def _fetch_pdf(session: requests.Session, url: str, dest: Path, retries: int = 3) -> bytes:
    if dest.is_file() and dest.stat().st_size > 0:
        return dest.read_bytes()
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=120)
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                raise ValueError("la respuesta no es un PDF")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
            return r.content
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    return b""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data/DOGV_SAMPLE", help="carpeta raíz del corpus (como CORPUS_ROOT)")
    ap.add_argument("--date", default=None, help="fecha del número más reciente (AAAA-MM-DD); por defecto el último")
    ap.add_argument("--issues", type=int, default=5, help="números consecutivos hacia atrás")
    ap.add_argument("--per-issue", type=int, default=40, help="disposiciones por número (0 = todas)")
    ap.add_argument("--langs", nargs="+", default=["va", "es"], choices=["va", "es"])
    ap.add_argument("--variant", default="pymupdf", help="nombre de la carpeta de variante (VARIANT en el notebook)")
    ap.add_argument("--max-pages", type=int, default=30, help="páginas máximas por PDF (listados enormes)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.25, help="pausa entre descargas por hilo, en segundos")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    out = Path(args.out)
    session = requests.Session()
    session.headers.update(HEADERS)
    date = args.date or latest_date(session)
    jobs = []
    for _ in range(args.issues):
        summaries = {lang: issue(session, date, lang) for lang in args.langs}
        num = next(iter(summaries.values()))["cabecera"]["numeroDogv"]
        api_dir = out / "metadata" / "api"
        api_dir.mkdir(parents=True, exist_ok=True)
        for lang, data in summaries.items():
            (api_dir / f"DOGV_{num}_{lang}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1),
                                                             encoding="utf-8")
        base = summaries[args.langs[0]]["disposiciones"]
        chosen = {d["codigoInsercion"] for d in _sample(base, args.per_issue or None, args.seed + num)}
        y, m, d = date.split("-")
        for lang, data in summaries.items():
            for disp in data["disposiciones"]:
                if disp["codigoInsercion"] in chosen and disp.get("urlPdf"):
                    jobs.append((date, num, lang, disp))
        print(f"DOGV {num} ({date}): {len(base)} disposiciones, se descargan {len(chosen)} × {len(args.langs)} idiomas")
        prev = previous_date(session, date)
        if not prev:
            break
        date = prev

    def work(job):
        date, num, lang, disp = job
        code = disp["codigoInsercion"].replace("/", "_")
        y, m, d = date.split("-")
        pdf = _fetch_pdf(session, PDF_BASE + disp["urlPdf"], out / "raw" / "pdf" / y / m / d / f"{code}_{lang}.pdf")
        md = mark_title(pdf_to_markdown(pdf, args.max_pages), disp)
        body = f"<!-- fuente: {PDF_BASE + disp['urlPdf']} -->\n\n{md}"
        h = hashlib.md5(pdf).hexdigest()[:10]
        dest = (out / "processed" / "markdown" / y / m / d / f"DOGV_{num}" / args.variant / lang
                / f"{date}__DOGV_{num}__{code}__{h}.md")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
        time.sleep(args.delay)
        return len(md)

    done = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, j): j for j in jobs}
        for fut in as_completed(futures):
            try:
                fut.result()
                done += 1
            except Exception as exc:
                failed += 1
                j = futures[fut]
                print(f"  ! {j[3]['codigoInsercion']} ({j[2]}): {exc}", file=sys.stderr)
            if (done + failed) % 25 == 0:
                print(f"  {done + failed}/{len(jobs)} PDFs procesados")
    print(f"Listo: {done} disposiciones en {out.resolve()} ({failed} fallos). "
          f"En el notebook: CORPUS_ROOT={str(out)!r}, VARIANT={args.variant!r}")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
