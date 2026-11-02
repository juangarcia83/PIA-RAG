"""Arranca Open WebUI configurado para el laboratorio DOGV.

    .venv-owui/Scripts/python integrations/openwebui/run_openwebui.py            # http://localhost:3000

- Datos (usuarios, chats, funciones) en integrations/openwebui/data.
- Sin conexiones a Ollama ni a OpenAI: los modelos los aporta la función «DOGV RAG Lab» (dogv_rag_pipe.py),
  que llama al servidor del RAG Lab (python run.py, puerto 8000).
- WEBUI_AUTH=False (un único usuario, sin login) es solo para uso local. Para compartirlo: OWUI_AUTH=1.
"""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
env = {
    **os.environ,
    "DATA_DIR": str(HERE / "data"),
    "WEBUI_NAME": "DOGV RAG Lab",
    "WEBUI_AUTH": "True" if os.environ.get("OWUI_AUTH") else "False",
    "ENABLE_OLLAMA_API": "False",
    "ENABLE_OPENAI_API": "False",
    "ENABLE_VERSION_UPDATE_CHECK": "False",
    "DEFAULT_LOCALE": os.environ.get("OWUI_LOCALE", "es-ES"),
    "PYTHONIOENCODING": "utf-8",
}
(HERE / "data").mkdir(exist_ok=True)
exe = Path(sys.executable).with_name("open-webui.exe" if os.name == "nt" else "open-webui")
port = os.environ.get("OWUI_PORT", "3000")
# cwd = data/: Open WebUI crea ahí su .webui_secret_key (y no en la raíz del repositorio)
sys.exit(subprocess.call([str(exe), "serve", "--host", "127.0.0.1", "--port", port], env=env, cwd=HERE / "data"))
