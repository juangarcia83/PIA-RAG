# RAG Lab · DOGV

Web interactiva para **usar y comparar arquitecturas RAG** sobre el Diari Oficial de la Generalitat Valenciana
(DOGV). Cada consulta se ejecuta con los pipelines reales y la interfaz anima, en directo, cada etapa: embedding,
búsqueda densa y BM25, fusión RRF, reranker, evaluador, agente y LLM.

Proyecto de ValgrAI · Generalitat Valenciana.

| Arquitectura | Qué hace |
|---|---|
| **Naive** | Chunks de tamaño fijo, retrieval denso top-k y generación. |
| **Híbrido** | Chunks estructurales con cabecera contextual, BM25 + denso fusionados con RRF (ablation sin reranker). |
| **Advanced** | Híbrido + reranker cross-encoder, deduplicación y reordenación del contexto («lost in the middle»). |
| **Corrective** | Advanced + evaluador de relevancia: si el retrieval es flojo reformula (multi-query + HyDE); si sigue flojo, se abstiene. |
| **Agentic** | Un LLM agente (ReAct) decide qué buscar, con qué filtros, qué leer entero y qué evidencias pasan al contexto. |

Secciones de la web: **Preguntar** (una arquitectura en directo, con grafo animado, narración y análisis),
**Comparar**, **Corpus**, **Mapa semántico**, **Evaluación** (hit@k, MRR, IC por bootstrap) y **Arquitecturas**.
Interfaz en valenciano.

**Documentos adjuntos** (chat del modo simple): el botón **+** o arrastrar y soltar añade un PDF, DOCX o TXT
(máx. 20 MB y 100 páginas) a la conversación. Los cortos (≤ 15.000 caracteres) entran enteros en el prompt; los
largos se trocean e indexan (BM25 + denso, RRF) y en cada pregunta se recuperan sus 4 fragmentos más pertinentes.
La respuesta los cita como [D1], [D2]… junto a las fuentes del DOGV. Solo se guardan en memoria del servidor, y su
texto se envía al LLM configurado. PDF con PyMuPDF4LLM; DOCX leído con la biblioteca estándar; sin OCR.

---

## Puesta en marcha

Requisitos: Python 3.11 o superior (probado con 3.12).

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt            # Linux/macOS: .venv/bin/python
cp .env.example .env                                               # y pon tu clave de DeepSeek en .env
.venv/Scripts/python scripts/download_dogv.py --issues 5 --per-issue 40   # muestra del DOGV en data/
.venv/Scripts/python run.py                                        # http://127.0.0.1:8000
```

- **Datos**: no están en el repositorio. `download_dogv.py` descarga de la API pública del DOGV las disposiciones
  de los últimos números y las convierte a Markdown en `data/DOGV_SAMPLE` (5 números × 40 ≈ 200 disposiciones,
  en valenciano y castellano).
- **Primer arranque**: descarga los modelos de Hugging Face (e5-small y el reranker, unos 2,7 GB) y calcula los
  embeddings (~1,5 min en CPU para 200 disposiciones; se guardan en `indexes/`). Después, cargar los modelos en
  CPU lleva 1–3 min; la interfaz muestra el progreso.
- **Sin clave del LLM** funciona en modo «solo retrieval». También se puede conectar otro LLM (cualquier API tipo
  OpenAI) desde el botón de la barra superior.
- **GPU NVIDIA**: instala antes PyTorch con CUDA; el laboratorio usa entonces `bge-m3` y más candidatos.

## Configuración

Por orden de prioridad: valores por defecto de `app/config.py` → `settings.json` en la raíz (ver
`settings.example.json`) → variables de entorno `RAGLAB_<CLAVE>` (p. ej. `RAGLAB_CORPUS_ROOT`, `RAGLAB_TOP_K`).

| Variable | Para qué |
|---|---|
| `DEEPSEEK_API_KEY` | Clave del LLM (en `.env` o en el entorno). Otro proveedor: `llm_base_url`, `llm_model`, `llm_api_key_env`. |
| `RAGLAB_PUBLIC=1` | Para exponerlo fuera de tu equipo: desactiva el cambio de LLM desde la interfaz. |
| `RAGLAB_CORPUS_ROOT` | Otro corpus con la misma estructura (p. ej. el `DOGV_CORPUS` completo, con `RAGLAB_VARIANT=deepseek`). |

## Seguridad

- Las claves van **solo** en `.env` (o en variables de entorno), que está en `.gitignore`. En el repositorio solo
  está `.env.example`, sin clave real.
- La clave que se introduce desde la interfaz queda en memoria y no se escribe en disco.
- `.gitignore` excluye también `settings.json`, los datos descargados (`data/`, con nombres y correos publicados
  en el DOGV), la caché de índices y los datos de Open WebUI (usuarios, chats y su `.webui_secret_key`).
- Para exponer la web fuera de tu equipo, arráncala con `RAGLAB_PUBLIC=1`.

## Estructura

```
run.py                      punto de entrada (python run.py --port 8000)
app/                        servidor (FastAPI)
  server.py                 rutas de la API y de la interfaz
  engine.py                 carga corpus, índices y modelos; ejecuta consultas y evaluaciones
  instrumentation.py        envuelve los componentes reales y emite un evento por etapa
  embed_bundle.py           vista incrustable autocontenida (para Open WebUI)
  config.py                 configuración y clave del LLM
dogvrag/                    librería RAG
  corpus.py, cleaning.py    carga del DOGV (Markdown + metadatos oficiales) y limpieza
  attachments.py            documentos adjuntos: conversión (PDF, DOCX, TXT), troceado e índice en memoria
  chunking.py               FixedChunker, StructureChunker
  embeddings.py, rerank.py  bi-encoder y cross-encoder (sentence-transformers)
  sparse.py, vectorstore.py BM25 (bm25s) y búsqueda densa exacta
  index.py, retrieval.py    índices con caché, retrievers denso/BM25/híbrido (RRF) y filtros
  pipelines.py              NaiveRAG, AdvancedRAG, CorrectiveRAG, AgenticRAG
  prompts.py                prompts (valenciano AVL y castellano RAE)
  generation.py             cliente LLM tipo OpenAI
  evaluation.py             hit@k, MRR y conjuntos de evaluación
web/                        interfaz (HTML + CSS + JS con módulos ES, sin compilación)
  index.html, embed.html
  css/styles.css            sistema de diseño (claro/oscuro)
  js/main.js, api.js, ui.js, i18n*.js, motion.js, narrate.js, embed.js
  js/views/                 una vista por sección
  js/viz/                   grafo animado, recorrido de candidatos, mapa, gráficos
  img/                      logos y franja de financiación
integrations/openwebui/     las arquitecturas como modelos de Open WebUI
scripts/download_dogv.py    descarga una muestra del DOGV (API pública + PDF -> Markdown) en data/
tests/                      pruebas sin modelos (HashingEmbedder y un LLM simulado)
docs/                       cómo funciona y cómo ampliarlo
```

## Desarrollo

```bash
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest          # 15 pruebas, ~2 s, sin descargar modelos
.venv/Scripts/python -m ruff check .
```

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): cómo funciona por dentro (eventos, API, interfaz, diseño).
- [docs/AMPLIAR.md](docs/AMPLIAR.md): añadir una arquitectura, adaptarlo a otro corpus y problemas conocidos.
- [integrations/openwebui/README.md](integrations/openwebui/README.md): uso desde Open WebUI.

Los logos de ValgrAI y de la Generalitat y la franja de financiación (`web/img/`) son marcas de sus titulares:
confirmad los derechos de uso antes de publicar la web.
