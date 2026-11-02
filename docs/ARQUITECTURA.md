# Cómo funciona el RAG Lab

```
navegador (web/, módulos ES)  ── HTTP / NDJSON ──►  app/server.py (FastAPI)
                                                       │
                                                       ▼
                                                 app/engine.py
                                                 · carga en segundo plano: corpus, índices, modelos
                                                 · una instancia por arquitectura
                                                       │  app/instrumentation.py envuelve sus componentes
                                                       ▼
                                                 dogvrag/ (pipelines, retrievers, reranker, LLM)
```

## 1. La librería (`dogvrag/`)

Todas las arquitecturas comparten interfaz:

- `search(question, filters, k) -> (hits, trace)`: solo retrieval (lo usa la evaluación).
- `retrieve(question, filters) -> (contexts, trace)`: fragmentos que irían al LLM.
- `answer(question, filters) -> RAGResult`: respuesta, contextos, tiempos y traza.

La respuesta final siempre la redacta el mismo prompt (`prompts.SYSTEM`): las diferencias entre arquitecturas
vienen solo de cómo se reúne el contexto.

| Clase | Puntos clave |
|---|---|
| `NaiveRAG` | `DenseRetriever` sobre el índice `naive` (chunks fijos, sin cabecera). |
| `AdvancedRAG` | `HybridRetriever` (BM25 + denso, RRF), `_candidates` (dedup, un idioma por disposición), `_rerank` (cross-encoder), small-to-big y reordenación. Con `reranker=None` es el **Híbrido**. |
| `CorrectiveRAG` | Si el mejor score del reranker `< tau_ok`, reformula (`REWRITE`) y escribe un documento hipotético (`HYDE`) y hace una 2ª pasada; si sigue `< tau_abstain`, se abstiene. |
| `AgenticRAG` | Bucle ReAct con protocolo JSON (sin function calling): `search` (consulta y filtros propios), `read` (lee entera una evidencia con sus vecinos) y `finish` (elige evidencias). Notifica cada paso por el gancho `_notify`. Sin LLM hace una búsqueda de Advanced. |

Índices (`index.build_index`): se cachean en `indexes/<nombre>-<huella>`. La huella depende del contenido de los
chunks, del chunker y del modelo de embeddings, no de la ruta: la caché se puede copiar entre equipos.

## 2. Instrumentación (`app/instrumentation.py`)

La web no reimplementa ningún pipeline. Durante cada consulta sustituye, **solo en esa instancia**, los métodos
de los componentes reales por envoltorios que emiten un evento, y los restaura al terminar (`patched`).

| Método envuelto | Evento |
|---|---|
| `embedder.embed_queries` | `embed` (dimensión, norma, primeras componentes) |
| `retriever.dense.retrieve` | `dense` |
| `retriever.sparse.retrieve` | `bm25` (tokens y términos presentes en cada hit) |
| `retriever.retrieve_multi` | `fusion` (listas, rango en cada lista, `rrf_k`, pesos) |
| `pipeline._candidates` | `candidates` |
| `pipeline._rerank` | `rerank` (score y posición previa) |
| `generator.generate` | `llm_start` / `llm` con `purpose`: `answer`, `rewrite`, `hyde`, `agent` |
| `pipeline._notify` | `agent_plan`, `agent_obs`, `agent_done` |

Todos los eventos llevan `type`, `t` (ms desde el inicio), `pass` (pasada de retrieval) y `chunks` (metadatos de
los chunks que aparecen por primera vez). El motor añade `start` (configuración y filtros) y `result` (respuesta,
contextos numerados, tiempos, traza, prompt exacto y proyección de la consulta) o `error`.

`overrides` aplica los parámetros que llegan de la interfaz (`TUNABLE`) solo durante la consulta. Las consultas
se ejecutan de una en una (lock): es un laboratorio, no un servicio con concurrencia.

## 3. API (`app/server.py`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/status` | Estado de la carga, modelos, LLM y configuración de cada arquitectura. |
| GET | `/api/corpus` | Disposiciones, estadísticas y longitudes de chunk. |
| GET | `/api/doc/{id}` | Texto de una disposición y cómo la trocea cada chunker. |
| GET | `/api/map/{index}` | Proyección PCA de los embeddings. |
| GET | `/api/examples` | Títulos al azar para inspirar preguntas. |
| POST | `/api/run` | `{question, pipeline, filters, options, generate}` → eventos en NDJSON. Cabecera `X-Run-Id`. |
| GET | `/api/runs/{id}` | Eventos de una ejecución (las últimas 300, en memoria). |
| POST | `/api/grounding` | Apoyo de cada frase de la respuesta en el contexto (coseno de embeddings). |
| POST | `/api/llm` | Conecta otro LLM (desactivado con `RAGLAB_PUBLIC=1`). |
| POST/GET | `/api/eval`, `/api/eval/{id}` | Evaluación de retrieval en segundo plano. |
| GET | `/embed/run/{id}`, `/embed/html/{id}` | Vista compacta de una ejecución: por URL o como HTML autocontenido. |

Documentación interactiva en `/api/docs`.

## 4. Interfaz (`web/`)

HTML, CSS y JavaScript con módulos ES, **sin compilación ni dependencias** (gráficos en SVG y canvas hechos a
mano). El servidor sirve `web/` en `/static/` con `Cache-Control: no-cache`.

| Fichero | Papel |
|---|---|
| `js/main.js` | Enrutado por hash (`#/ask`, `#/compare`, `#/corpus`, `#/map`, `#/eval`, `#/learn`), tema, idioma, diálogo del LLM, sondeo de la carga. |
| `js/api.js` | `getJSON`, `postJSON`, `cached`, `streamRun` (lector NDJSON cancelable). |
| `js/ui.js` | `h()`/`s()` (crear HTML/SVG), iconos, formatos, tooltip, toast, `renderAnswer`, `hero`, `seg`, `store`, **`PIPES`** y **`PIPE_ORDER`**. |
| `js/i18n.js`, `js/i18n-va.js` | `t("texto en castellano", {vars})`; el diccionario valenciano usa el texto castellano como clave. |
| `js/narrate.js` | `describe(ev, ctx)`: una frase por evento para la narración paso a paso. |
| `js/motion.js` | Aparición al hacer scroll, `stagger`, indicador de pestaña. |
| `js/viz/pipeline.js` | `GRAPHS` (nodos y aristas de cada arquitectura) y `PipelineGraph.apply(ev)`. |
| `js/viz/flow.js` | `RankFlow`: cómo se mueve cada candidato entre etapas. |
| `js/viz/charts.js`, `map.js`, `constellation.js` | Gráficos SVG, mapa semántico en canvas y arte del hero. |
| `js/views/*.js` | Una vista por sección; `ask.js` contiene `RunPanel` (grafo, narración, respuesta, fuentes, pestañas de análisis). |
| `js/embed.js` + `app/embed_bundle.py` | Vista incrustable; el mini-bundler en Python inlinea CSS, módulos y datos en un único HTML. |

### Diseño

- Tipografías: **Fraunces** (títulos), **Inter** (texto), **JetBrains Mono** (datos).
- Acento azul GVA `#003da5` y degradado ValgrAI `#1a0088 → #390092 → #41b8ee`.
- Un color por arquitectura (`--c-naive`, `--c-hybrid`, `--c-advanced`, `--c-corrective`, `--c-agentic`),
  redefinido en los dos bloques de modo oscuro de `styles.css`.
- Se respeta `prefers-reduced-motion`.

## 5. Prompts (`dogvrag/prompts.py`)

- `SYSTEM` (va/es): fidelidad a las fuentes, cita `[n]` tras cada dato, datos sensibles literales, fragmentos como
  datos (no instrucciones). Formato fijo **Resposta / Detall / Observacions**. Norma lingüística: valenciano de la
  AVL o castellano de la RAE.
- `REWRITE`, `HYDE` (Corrective) · `QUESTION_GEN` (evaluación sintética) · `AGENT`, `AGENT_TURN` (Agentic).
