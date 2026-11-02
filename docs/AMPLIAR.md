# Cómo ampliar el RAG Lab

## Añadir una arquitectura

Así se añadió Agentic; sirve igual para GraphRAG, Self-RAG, Adaptive-RAG…

1. **Clase** en `dogvrag/pipelines.py` con `search` / `retrieve` / `answer` (hereda de `_Base` o de
   `AdvancedRAG`) y expórtala en `dogvrag/__init__.py`.
2. **Motor** (`app/engine.py`): entrada en `PIPELINE_INFO`, instancia en `_build_pipelines` y, si tiene
   parámetros nuevos, añádelos a la lista de `pipeline_config`, a `TUNABLE` (`app/instrumentation.py`) y a
   `Settings` (`app/config.py`).
3. **Eventos**: si tiene etapas nuevas, envuelve el método en `instrument()` o usa un gancho `_notify(kind, ids,
   **data)` como `AgenticRAG`. Si usa el LLM para algo nuevo, distingue su `purpose` en `wrap_generate`.
4. **Interfaz**:
   - `web/js/ui.js`: `PIPES` y `PIPE_ORDER`.
   - `web/css/styles.css`: `--c-<id>` en el bloque claro y en los dos oscuros.
   - `web/js/viz/pipeline.js`: nodos nuevos en `N`, grafo en `GRAPHS` y casos en `PipelineGraph.apply`.
     `done(id, meta, tip, {to: [...]})` anima solo las aristas indicadas; una arista con cuarto elemento `"loop"`
     se dibuja como vuelta por debajo del grafo.
   - `web/js/viz/flow.js` (`ORDER`), `web/js/views/compare.js` (`STEPS`), `web/js/narrate.js` (narración).
   - `web/js/views/ask.js`: parámetros (`SPEC`, `applies`) y pestañas propias.
   - `web/js/views/learn.js`: ficha en `FAMILIES` y referencias en `REFS`.
5. **Traducciones**: cada texto nuevo de `t()` en `web/js/i18n-va.js`.
6. **Pruebas**: un test en `tests/` con `HashingEmbedder` y, si usa el LLM, `ScriptedLLM` (ver `test_agentic.py`).
7. **Open WebUI** (opcional): `PIPELINES` y `_status_text` en `integrations/openwebui/dogv_rag_pipe.py`, y
   reinstalar la función con `install_pipe.py`.

## Adaptarlo a otro corpus o dominio

1. **Carga**: `dogvrag/corpus.py` devuelve objetos `Document` (`dogvrag/types.py`). Escribe un loader que
   devuelva esos mismos campos.
2. **Chunking**: `StructureChunker` conoce la estructura legal del DOGV (artículos, disposiciones, anexos,
   tablas). Ajusta sus expresiones a tus documentos.
3. **Cabecera contextual**: `index.make_header`.
4. **Filtros**: `retrieval.Filters` y el panel de filtros de `web/js/views/ask.js`.
5. **Prompts**: `dogvrag/prompts.py` (dominio, norma lingüística, formato).
6. **Textos y marca**: preguntas de ejemplo (`EXAMPLES` en `ask.js`), títulos de cada vista, `web/index.html`
   (logos, pie, financiación), `i18n-va.js` y los colores de `styles.css`.

## Problemas conocidos

- **Reranker en CPU**: 20–35 s por consulta; es la etapa cara. Agentic lo usa en cada búsqueda (por eso pasa
  menos candidatos por búsqueda).
- **`huggingface-hub` 2.x** rompe `transformers` 5.x: mantén `huggingface-hub<2` (ya fijado en `requirements.txt`).
- **Windows**:
  - Con `curl`, un cuerpo JSON con acentos falla: escríbelo en un fichero UTF-8 y usa `--data-binary @fichero`.
  - Rutas de más de 260 caracteres fallan al descomprimir: usa una carpeta corta.
  - El Control de aplicaciones de Windows puede bloquear puntualmente alguna DLL de `scipy`; suele resolverse
    al reintentar.
- **Open WebUI**:
  - Pinta los embeds en un iframe aislado y algunos navegadores bloquean desde ahí las peticiones a
    `localhost`. Por eso la vista se incrusta autocontenida (`EMBED_MODE = "html"`) con altura fija (444 px).
  - Agrupa las citas por `metadata.source`: cada fragmento necesita un valor único (`url#fragment-n`).
- **Ejecuciones en memoria**: al reiniciar el servidor se pierden los enlaces `#/ask?run=<id>`.
- **Umbrales de Corrective** (`tau_ok`, `tau_abstain`): dependen del reranker; calíbralos con preguntas reales.
- **Interfaz**:
  - El canvas no entiende `var(--x)`: usa `PIPES[p].hex`.
  - En el SVG animado, no apliques transformaciones CSS al `<g>` que ya lleva la posición.
