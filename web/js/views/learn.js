// Arquitecturas: qué hace cada familia, por qué, con qué parámetros y en qué literatura se apoya.
import { h, hero, icon, PIPES, PIPE_ORDER, sleep } from "../ui.js";
import { t } from "../i18n.js";
import { PipelineGraph, GRAPHS } from "../viz/pipeline.js";

const FAMILIES = {
  naive: {
    title: "Naive RAG",
    lead: "El esquema original: trocear, embeber, buscar los k vecinos más cercanos y pasarlos al LLM.",
    points: [
      "Chunks de tamaño fijo (1.200 caracteres, solapamiento de 150), cortados en el espacio más cercano.",
      "Un único bi-encoder (multilingual-e5 / BGE-M3) para consulta y documentos; similitud coseno exacta.",
      "Sin cabecera contextual: el chunk se embebe sin saber a qué disposición pertenece.",
      "Línea base: barata y rápida, pero frágil ante códigos, nombres propios y preguntas ambiguas.",
    ],
    formula: "score(q, c) = cos(E(q), E(c)) = E(q) · E(c)   (vectores normalizados)",
  },
  hybrid: {
    title: "Híbrido (ablation)",
    lead: "Advanced sin reranker: aísla cuánto aportan el chunking estructural, la cabecera y la fusión léxico-densa.",
    points: [
      "Chunking por estructura del DOGV: encabezados, artículos, disposiciones, anexos y tablas.",
      "Cabecera determinista (número, fecha, organismo, sección, título, apartado) delante de cada chunk.",
      "BM25 con stemming catalán y denso en paralelo, fusionados con Reciprocal Rank Fusion.",
      "Prefiltro por metadatos antes de buscar (organismo, sección, fechas, número de DOGV).",
    ],
    formula: "RRF(c) = Σ_listas  w_i / (k + rango_i(c)),   k = 60",
  },
  advanced: {
    title: "Advanced RAG",
    lead: "Pre-retrieval y post-retrieval: mejor indexado, búsqueda híbrida y un reranker que relee los candidatos.",
    points: [
      "Todo lo del híbrido, más un cross-encoder (bge-reranker-v2-m3) sobre los N mejores candidatos.",
      "Deduplicación por hash del texto y un solo idioma por disposición en índices bilingües.",
      "Expansión opcional a chunks vecinos (small-to-big) y fusión de trozos contiguos.",
      "Reordenación «lost in the middle»: lo mejor al principio y al final del prompt.",
    ],
    formula: "BM25(q, c) = Σ_t IDF(t) · f(t,c)(k1+1) / (f(t,c) + k1(1 − b + b·|c|/avgdl))",
  },
  corrective: {
    title: "Corrective RAG",
    lead: "Un evaluador decide si el retrieval es fiable antes de generar: si no lo es, corrige; si sigue sin serlo, se abstiene.",
    points: [
      "Evaluador ligero: el mejor score del reranker frente a τ_ok (correcto) y τ_abstain (incorrecto).",
      "Si es ambiguo: multi-query (el LLM reformula con vocabulario administrativo) y HyDE (documento hipotético).",
      "Segunda pasada híbrida con todas las consultas, reranking y fusión con la primera.",
      "Abstención explícita en lugar de una respuesta inventada: prioriza la fidelidad sobre la cobertura.",
    ],
    formula: "veredicto = correcto si max s ≥ τ_ok · ambiguo si τ_abstain ≤ max s < τ_ok · incorrecto si no",
  },
  agentic: {
    title: "Agentic RAG",
    lead: "El retrieval deja de ser un flujo fijo: un LLM agente decide qué buscar, cómo, cuántas veces y con qué evidencias se queda.",
    points: [
      "Bucle ReAct: en cada paso el LLM razona y elige una herramienta (buscar, leer una evidencia entera o terminar).",
      "Cada búsqueda es la de Advanced (BM25 + denso, RRF y reranker), con la consulta y los filtros que propone el agente.",
      "Descompone preguntas compuestas, reformula si los resultados son flojos y filtra por organismo, sección o fechas.",
      "Elige las evidencias que pasan al contexto; si no hay ninguna pertinente, se abstiene. Coste: una llamada al LLM por paso.",
    ],
    formula: "aₜ = LLM(pregunta, o₁…oₜ₋₁) ∈ {search(q, f), read(Eᵢ), finish(E)}   ·   contexto = E elegidas",
  },
};

const REFS = [
  ["Lewis et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.", "https://arxiv.org/abs/2005.11401"],
  ["Gao et al. (2023). Retrieval-Augmented Generation for Large Language Models: A Survey.", "https://arxiv.org/abs/2312.10997", "taxonomía naive / advanced / modular"],
  ["Robertson & Zaragoza (2009). The Probabilistic Relevance Framework: BM25 and Beyond.", "https://doi.org/10.1561/1500000019"],
  ["Cormack, Clarke & Büttcher (2009). Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods. SIGIR.", "https://doi.org/10.1145/1571941.1572114"],
  ["Wang et al. (2022). Text Embeddings by Weakly-Supervised Contrastive Pre-training (E5).", "https://arxiv.org/abs/2212.03533"],
  ["Chen et al. (2024). BGE M3-Embedding: multi-lingual, multi-functionality, multi-granularity.", "https://arxiv.org/abs/2402.03216"],
  ["Nogueira & Cho (2019). Passage Re-ranking with BERT.", "https://arxiv.org/abs/1901.04085"],
  ["Liu et al. (2023). Lost in the Middle: How Language Models Use Long Contexts.", "https://arxiv.org/abs/2307.03172"],
  ["Gao, Ma, Lin & Callan (2022). Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE).", "https://arxiv.org/abs/2212.10496"],
  ["Yan et al. (2024). Corrective Retrieval Augmented Generation.", "https://arxiv.org/abs/2401.15884"],
  ["Yao et al. (2023). ReAct: Synergizing Reasoning and Acting in Language Models. ICLR.", "https://arxiv.org/abs/2210.03629"],
  ["Singh et al. (2025). Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG.", "https://arxiv.org/abs/2501.09136"],
];

const PROPOSALS = [
  ["GraphRAG sobre referencias normativas", "ambicioso", "Las disposiciones se citan entre sí («Decret 68/2026», «Llei 5/2026», correcciones de errores). Un grafo de referencias extraído con expresiones regulares permitiría recuperar la norma que se desarrolla o corrige (multi-hop) y responder «¿qué está vigente?». Edge et al., 2024.", "https://arxiv.org/abs/2404.16130"],
  ["Router adaptativo (Adaptive-RAG)", "medio", "Un clasificador ligero decide por pregunta si basta Naive, hace falta Advanced/Corrective o no hace falta retrieval. Reduce latencia media sin perder calidad. Jeong et al., 2024.", "https://arxiv.org/abs/2403.14403"],
  ["Self-query: filtros extraídos de la pregunta", "fácil", "Que el LLM convierta «subvencions de Sanitat d'octubre» en Filters(organismo, date_from, date_to). Aprovecha el prefiltro que ya existe y que hoy solo se usa a mano."],
  ["Evaluación de la generación (RAGAS)", "medio", "Medir fidelidad, relevancia de la respuesta y precisión/recall del contexto con un LLM juez. La comprobación de fundamentación de esta web es una primera aproximación sin LLM. Es et al., 2023.", "https://arxiv.org/abs/2309.15217"],
  ["Self-RAG / verificación de citas", "medio", "Que el modelo critique sus propias afirmaciones y re-busque si una frase no está apoyada. Asai et al., 2023.", "https://arxiv.org/abs/2310.11511"],
  ["Retrieval multi-vector con BGE-M3", "medio", "BGE-M3 da a la vez vectores densos, pesos léxicos y representaciones ColBERT. Comparar late interaction con el híbrido BM25 + denso actual. Khattab & Zaharia, 2020.", "https://arxiv.org/abs/2004.12832"],
  ["Contextual retrieval con LLM", "fácil", "Sustituir la cabecera determinista por un resumen generado por chunk (Anthropic, 2024) y medir la diferencia: ablation directa sobre el índice advanced."],
  ["RAPTOR: resúmenes jerárquicos", "ambicioso", "Árbol de resúmenes por número del DOGV y por organismo para preguntas agregadas («¿qué ha publicado Sanitat esta semana?»). Sarthi et al., 2024.", "https://arxiv.org/abs/2401.18059"],
  ["Rigor estadístico", "fácil", "Conjunto anotado a mano (~100 preguntas) e intervalos de confianza por bootstrap con pruebas pareadas entre arquitecturas. La vista de Evaluación ya calcula los intervalos."],
];

export function learnView(root) {
  const graphs = [];
  root.append(hero(6, "Arquitecturas", "Familias de *RAG*",
    t("Cinco arquitecturas, de la más simple a la más autónoma. Cada una añade una pieza y se puede medir qué aporta.")));

  for (const p of PIPE_ORDER) {
    const f = FAMILIES[p];
    const box = h("div", { class: "pipe-wrap" });
    const card = h("div", { class: "card", style: { marginTop: "16px", "--pc": PIPES[p].color } },
      h("div", { class: "family" },
        h("div", {},
          h("h3", {}, h("span", { class: "dot", style: { background: PIPES[p].color, width: "12px", height: "12px" } }), t(f.title)),
          h("p", {}, t(f.lead)), h("div", { class: "formula", style: { marginTop: "12px" } }, t(f.formula))),
        h("ul", { style: { marginTop: "6px" } }, f.points.map((x) => h("li", {}, t(x)))),
        h("div", { class: "family-graph" }, box, h("button", { class: "btn ghost sm", onclick: () => play(g) }, icon("play"), t("Animar")))));
    root.append(card);
    const g = new PipelineGraph(box, p, PIPES[p].color);
    graphs.push(g);
  }

  root.append(
    h("div", { class: "section-title" }, h("h2", {}, t("Conceptos clave"))),
    h("div", { class: "grid g3" },
      concept("Bi-encoder vs cross-encoder", "El bi-encoder embebe consulta y documento por separado: se precalcula el índice y la búsqueda es un producto escalar. El cross-encoder los lee juntos con atención cruzada: mucho más preciso y mucho más caro, por eso solo reordena candidatos."),
      concept("Léxico + semántico", "BM25 acierta con términos exactos (códigos de inserción, números de expediente, topónimos); el denso con paráfrasis y sinónimos. RRF los combina por posición, sin calibrar escalas distintas."),
      concept("Chunking", "El tamaño fijo parte artículos por la mitad; el estructural respeta la jerarquía del texto legal y anota el apartado. La cabecera contextual hace que un chunk aislado «sepa» de qué disposición viene."),
      concept("Lost in the middle", "Los LLM usan peor la información situada en medio de un contexto largo. Reordenar pone los fragmentos más relevantes en los extremos."),
      concept("HyDE", "Se busca con el embedding de un documento hipotético escrito por el LLM, que se parece más a los documentos reales que la pregunta. Útil cuando la pregunta usa otro registro que el DOGV."),
      concept("Abstención", "Un sistema que dice «no lo sé» cuando el retrieval es flojo es preferible en un dominio jurídico-administrativo: una respuesta inventada con cita oficial es peor que ninguna.")),
    h("div", { class: "section-title" }, h("h2", {}, t("Propuestas para ampliar el estudio"))),
    h("div", { class: "card" }, h("div", { class: "grid g2", style: { gap: "20px 28px" } }, PROPOSALS.map(([title, lvl, d, url]) =>
      h("div", { class: "prop" }, h("h4", {}, t(title), h("span", { class: "tag" }, t(lvl))), h("p", {}, t(d), url ? [" ", h("a", { href: url, target: "_blank", rel: "noopener" }, "Paper ↗")] : null))))),
    h("div", { class: "section-title" }, h("h2", {}, t("Referencias"))),
    h("div", { class: "card" }, h("ol", { class: "refs" }, REFS.map(([title, u, note]) => h("li", {}, title, note ? ` (${t(note)})` : "", " ", h("a", { href: u, target: "_blank", rel: "noopener" }, "↗"))))),
  );

  let alive = true;
  (async () => { for (const g of graphs) { if (!alive) return; await play(g); } })();
  return { destroy: () => { alive = false; } };
}

function concept(title, text) {
  return h("div", { class: "card" }, h("h3", { style: { marginBottom: "6px" } }, t(title)), h("p", { class: "small ink2", style: { margin: 0 } }, t(text)));
}

async function play(g) {
  g.reset();
  const nodes = Object.entries(GRAPHS[g.pipeline].nodes).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(([id]) => id);
  if (g.pipeline === "agentic") {   // dos vueltas del bucle: buscar, leer y terminar
    for (const [id, to] of [["q"], ["agent", ["search"]], ["search", ["rerank"]], ["rerank", ["obs"]], ["obs", ["agent"]],
      ["agent", ["read"]], ["read", ["obs"]], ["obs", ["ctx"]], ["ctx"], ["llm"]]) {
      g.done(id, "", null, { to });
      await sleep(id === "obs" ? 520 : 300);
    }
    return;
  }
  for (const id of nodes) {
    if (id === "rewrite") continue;
    g.done(id, "", null, { variant: id === "gate" ? "warn" : undefined });
    await sleep(260);
    if (id === "gate") { g.done("rewrite", ""); await sleep(420); }
  }
}
