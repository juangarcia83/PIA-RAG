# DOGV RAG Lab en Open WebUI

Las cinco arquitecturas del estudio (Naive, Híbrido, Advanced, Corrective, Agentic) como modelos de Open WebUI. No se
reimplementa nada: la función `dogv_rag_pipe.py` llama al servidor del RAG Lab (`python run.py`), que ejecuta
los mismos pipelines que el notebook, y traduce sus eventos al formato de Open WebUI.

| En el RAG Lab | En Open WebUI |
|---|---|
| Elegir arquitectura | Selector de modelos: `DOGV · Naive`, `· Híbrido`, `· Advanced`, `· Corrective`, `· Agentic` |
| Etapas en directo | Estado bajo la respuesta («BM25 · términos…», «Reranker: leyendo 15 candidatos…», «Listo en 5,1 s») |
| Fuentes | Citas nativas [1], [2]… con el fragmento y el enlace al PDF |
| Grafo animado y recorrido de candidatos | Incrustados bajo cada respuesta, con enlace «Abrir en RAG Lab» a esa misma ejecución |
| Comparar | Chat con varios modelos a la vez (lado a lado) |
| — | Valoraciones 👍/👎 y modo Arena: evaluación humana a ciegas |

El idioma de la respuesta sigue al de la pregunta (valenciano o castellano). Las tareas auxiliares de Open WebUI
(título, etiquetas) se contestan sin lanzar el RAG.

## Puesta en marcha (local)

```bash
python run.py                                    # 1. RAG Lab, http://localhost:8000
py -3.12 -m venv --system-site-packages .venv-owui  # 2. entorno de Open WebUI (una vez)
.venv-owui/Scripts/python -m pip install open-webui
.venv-owui/Scripts/python integrations/openwebui/run_openwebui.py   # 3. http://localhost:3000
python integrations/openwebui/install_pipe.py                    # 4. instala/actualiza y activa la función
```

`run_openwebui.py` guarda los datos en `integrations/openwebui/data`, desactiva las conexiones a Ollama y OpenAI (los modelos
los aporta la función) y arranca **sin login** (un usuario local). Para compartirlo, `OWUI_AUTH=1`.

`install_pipe.py` usa la API de Open WebUI. En una instancia con login: `OWUI_URL=… OWUI_TOKEN=<clave de API de
administrador> RAGLAB_URL=… RAGLAB_PUBLIC_URL=… python integrations/openwebui/install_pipe.py`. También se puede pegar el
contenido de `dogv_rag_pipe.py` a mano en *Panel de administración → Funciones*.

## Válvulas (ajustes de la función)

| Válvula | Por defecto | Para qué |
|---|---|---|
| `RAGLAB_URL` | `http://localhost:8000` | El RAG Lab visto desde el servidor de Open WebUI (en Docker, el nombre del servicio). |
| `RAGLAB_PUBLIC_URL` | `http://localhost:8000` | El RAG Lab visto desde el navegador; solo para el enlace «Abrir en RAG Lab». |
| `ANSWER_LANG` | `auto` | `auto` (el de la pregunta), `va` o `es`. |
| `SHOW_PROCESS` | `true` | Incrustar el proceso animado bajo cada respuesta. |
| `EMBED_MODE` | `html` | `html`: vista autocontenida (estilos, código y datos dentro; funciona con cualquier sandbox). `url`: iframe que carga `/embed/run/<id>` del RAG Lab. |
| `TIMEOUT_SECONDS` | `600` | El reranker en CPU tarda ~30 s por consulta. |

## Notas

- La generación la hace el LLM configurado en el RAG Lab (DeepSeek), no Open WebUI: así las respuestas son las
  mismas que en el notebook y en la web.
- El RAG Lab guarda en memoria las últimas 300 ejecuciones (`/api/runs/<id>`); al reiniciarlo, los enlaces
  «Abrir en RAG Lab» de chats antiguos dejan de funcionar, pero la vista incrustada sigue viéndose porque lleva
  sus datos dentro.
- Para exponerlo fuera de tu equipo arranca el RAG Lab con `RAGLAB_PUBLIC=1` (desactiva `POST /api/llm`).
