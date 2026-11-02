"""Instala (o actualiza) la función «DOGV RAG Lab» en una instancia de Open WebUI y la activa.

    python integrations/openwebui/install_pipe.py
    OWUI_URL=https://chat.ejemplo.org OWUI_TOKEN=sk-... RAGLAB_URL=http://raglab:8000 python integrations/openwebui/install_pipe.py

- OWUI_URL      Open WebUI (por defecto http://localhost:3000).
- OWUI_TOKEN    clave de API de un administrador (Ajustes → Cuenta → Claves de API). Si no se da, se usa la sesión
                automática del modo sin login (WEBUI_AUTH=False), que es el de run_openwebui.py.
- RAGLAB_URL         servidor del RAG Lab visto desde Open WebUI (por defecto http://localhost:8000).
- RAGLAB_PUBLIC_URL  el mismo servidor visto desde el navegador, para incrustar el proceso (por defecto = RAGLAB_URL).
"""
import os
import re
import sys
from pathlib import Path

import requests

FUNCTION_ID = "dogv_rag"
OWUI = os.environ.get("OWUI_URL", "http://localhost:3000").rstrip("/")
RAGLAB = os.environ.get("RAGLAB_URL", "http://localhost:8000")
RAGLAB_PUBLIC = os.environ.get("RAGLAB_PUBLIC_URL", RAGLAB)


def token() -> str:
    if os.environ.get("OWUI_TOKEN"):
        return os.environ["OWUI_TOKEN"]
    # modo sin login: el servidor ignora las credenciales y abre sesión con su usuario local
    r = requests.post(f"{OWUI}/api/v1/auths/signin", json={"email": "", "password": ""}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"No hay OWUI_TOKEN y la instancia exige login ({r.status_code}). Crea una clave de API de administrador.")
    return r.json()["token"]


def main() -> None:
    content = Path(__file__).with_name("dogv_rag_pipe.py").read_text(encoding="utf-8")
    description = re.search(r"^description:\s*(.+)$", content, re.M).group(1).strip()
    headers = {"Authorization": f"Bearer {token()}"}
    form = {"id": FUNCTION_ID, "name": "DOGV RAG Lab", "content": content,
            "meta": {"description": description, "manifest": {}}}

    exists = requests.get(f"{OWUI}/api/v1/functions/id/{FUNCTION_ID}", headers=headers, timeout=30).status_code == 200
    url = f"{OWUI}/api/v1/functions/id/{FUNCTION_ID}/update" if exists else f"{OWUI}/api/v1/functions/create"
    r = requests.post(url, headers=headers, json=form, timeout=60)
    r.raise_for_status()
    print(("Actualizada" if exists else "Creada"), "la función", FUNCTION_ID)

    fn = requests.get(f"{OWUI}/api/v1/functions/id/{FUNCTION_ID}", headers=headers, timeout=30).json()
    if not fn.get("is_active"):
        requests.post(f"{OWUI}/api/v1/functions/id/{FUNCTION_ID}/toggle", headers=headers, timeout=30).raise_for_status()
        print("Activada")

    valves = {"RAGLAB_URL": RAGLAB, "RAGLAB_PUBLIC_URL": RAGLAB_PUBLIC}
    requests.post(f"{OWUI}/api/v1/functions/id/{FUNCTION_ID}/valves/update", headers=headers, json=valves,
                  timeout=30).raise_for_status()
    print("Válvulas:", valves)

    models = requests.get(f"{OWUI}/api/models", headers=headers, timeout=60).json().get("data", [])
    print("Modelos disponibles:", ", ".join(m["name"] for m in models if m["id"].startswith(FUNCTION_ID)))


if __name__ == "__main__":
    try:
        main()
    except requests.ConnectionError:
        sys.exit(f"No hay respuesta de Open WebUI en {OWUI}. Arráncalo antes (python integrations/openwebui/run_openwebui.py).")
