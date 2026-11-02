"""Vista incrustada autocontenida: un único HTML con estilos, código y datos dentro.

Open WebUI pinta los embeds que no son URL en un iframe `srcdoc` con sandbox. Si ese iframe tuviera que pedir
módulos o datos al RAG Lab, dependería del navegador, de la red y de la configuración del sandbox; así no pide
nada. Los módulos ES se empaquetan con un mini-bundler: cada fichero se envuelve en una función que devuelve sus
exportaciones y los `import { a, b } from "./x.js"` se sustituyen por lecturas de ese registro. Solo cubre las
formas que usa este código (imports con llaves y `export function|const|class`).
"""
from __future__ import annotations

import json
import re
from html import escape
from pathlib import Path, PurePosixPath

STATIC = Path(__file__).resolve().parent.parent / "web"
ENTRY = "js/embed.js"

_IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";\s*$', re.M)
_EXPORT = re.compile(r"^export\s+((?:async\s+)?(?:function\*?|const|let|class))\s+([\w$]+)", re.M)


def _resolve(base: str, spec: str) -> str:
    return str(PurePosixPath(base).parent.joinpath(spec))


def _norm(path: str) -> str:
    parts: list[str] = []
    for part in path.split("/"):
        if part == "..":
            parts.pop()
        elif part not in ("", "."):
            parts.append(part)
    return "/".join(parts)


def bundle(entry: str = ENTRY) -> str:
    order: list[str] = []
    seen: set[str] = set()
    sources: dict[str, str] = {}

    def visit(path: str) -> None:
        if path in seen:
            return
        seen.add(path)
        code = (STATIC / path).read_text(encoding="utf-8")
        for _, spec in _IMPORT.findall(code):
            visit(_norm(_resolve(path, spec)))
        sources[path] = code
        order.append(path)

    visit(entry)
    out = ["const __m = {};"]
    for path in order:
        code = sources[path]
        code = _IMPORT.sub(lambda m, base=path: f"const {{{m.group(1).strip()}}} = __m[{json.dumps(_norm(_resolve(base, m.group(2))))}];", code)
        names = [m.group(2) for m in _EXPORT.finditer(code)]
        code = _EXPORT.sub(lambda m: f"{m.group(1)} {m.group(2)}", code)
        out.append(f"__m[{json.dumps(path)}] = (() => {{\n{code}\nreturn {{ {', '.join(names)} }};\n}})();")
    return "\n".join(out)


def page(run: dict, lang: str, base: str) -> str:
    """HTML completo de la vista de una ejecución, sin ninguna petición al RAG Lab."""
    html = (STATIC / "embed.html").read_text(encoding="utf-8")
    css = (STATIC / "css" / "styles.css").read_text(encoding="utf-8")
    cfg = json.dumps({"run": run["id"], "lang": lang, "base": base, "data": run}, ensure_ascii=False, default=str)
    js = f"window.RAGLAB_EMBED = {cfg};\n{bundle()}"
    js = js.replace("</script", "<\\/script")          # nada dentro del script puede cerrarlo
    html = html.replace('<link rel="stylesheet" href="/static/css/styles.css">', f"<style>\n{css}\n</style>", 1)
    html = re.sub(r'<script type="module" src="/static/js/embed.js"[^>]*></script>',
                  lambda _: f'<script type="module">\n{js}\n</script>', html, count=1)
    if base:
        html = html.replace("<head>", f'<head>\n  <base href="{escape(base, quote=True)}/" target="_blank">', 1)
    return html
