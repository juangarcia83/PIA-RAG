// Arquitecturas: cada familia RAG explicada con una pregunta real del DOGV. Arriba se elige la arquitectura en una
// escalera (qué añade cada una y cuánto cuesta); un recorrido animado sigue la pregunta etapa a etapa sobre el grafo
// del pipeline; debajo, la ficha técnica, los conceptos clave y, plegadas, las propuestas y las referencias.
// Los textos del recorrido están escritos directamente en valenciano (la interfaz solo está en valenciano); el resto
// pasa por t() como en las demás vistas. Los valores de «entra» y «ix» son ilustrativos.
import { h, hero, icon, store, PIPES, PIPE_ORDER } from "../ui.js";
import { t } from "../i18n.js";
import { PipelineGraph } from "../viz/pipeline.js";

const QUERY = "Quina profunditat té el sondeig d'aigües subterrànies autoritzat a Figueroles?";

// Una etapa por nodo del grafo; `to` limita qué aristas se animan (bucles de Corrective y Agentic).
const STAGES = {
  q: { title: "La consulta", text: "La persona usuària escriu la pregunta en llenguatge natural. És l'única entrada: tot el que ve després depén de com estiga formulada.",
    in: QUERY, out: "text de la consulta" },
  embed: { title: "Embedding de la consulta", meta: "384 d", text: "Un bi-encoder (multilingual-e5) convertix la consulta en un vector que en representa el significat. Els fragments del DOGV es van convertir igual en indexar, així que ara es poden comparar.",
    in: "text de la consulta", out: "[0,021 · −0,113 · 0,087 · …]  vector de 384 dimensions" },
  tok: { title: "Tokenitzat", meta: "6 termes", text: "Per a la cerca lèxica, la consulta passa a minúscules, perd accents i paraules buides, i cada paraula es reduïx a la seua arrel (stemming en català).",
    in: "text de la consulta", out: "profunditat · sondeig · aigu · subterrani · autoritz · figuerol" },
  dense: { title: "Cerca densa", meta: "top 15", text: "Compara el vector de la consulta amb el de tots els fragments (similitud cosinus) i es queda amb els més pròxims en significat, encara que no compartisquen paraules.",
    in: "vector de la consulta + índex de fragments", out: "fragments per similitud: 0,86 · 0,84 · 0,81 · …" },
  bm25: { title: "Cerca lèxica BM25", meta: "top 15", text: "Puntua els fragments que contenen els termes de la consulta i dona més pes als termes rars. «Figueroles» apareix en molt pocs fragments, així que tira cap amunt del correcte.",
    in: "termes de la consulta", out: "fragments per coincidència de termes: 14,2 · 11,7 · 9,3 · …" },
  rrf: { title: "Fusió RRF", meta: "2 llistes", text: "Reciprocal Rank Fusion combina les dues llistes per posició: un fragment ben situat en totes dues puja. No cal comparar puntuacions d'escales diferents.",
    in: "llista densa + llista BM25", out: "una sola llista fusionada" },
  cand: { title: "Deduplicació i top-N", meta: "15 candidats", text: "Lleva textos repetits, conserva un sol idioma per disposició i retalla la llista als N millors candidats.",
    in: "llista fusionada", out: "15 candidats únics" },
  rerank: { title: "Reranker", meta: "0 – 1", text: "Un cross-encoder llig la consulta i cada candidat junts i en puntua la rellevància. És molt més precís que el bi-encoder, però també més lent: per això només reordena els candidats.",
    in: "consulta + 15 candidats", out: "candidats reordenats: 0,97 · 0,41 · 0,12 · …" },
  gate: { title: "Avaluador de rellevància", meta: "dubtós", variant: "warn", to: ["rewrite"], text: "Mira la millor puntuació del reranker. Si supera τ_ok el retrieval és fiable i continua; si és molt baixa, s'absté; enmig, com ací, intenta corregir-lo abans de respondre.",
    in: "millor puntuació del reranker", out: "veredicte: correcte · dubtós · incorrecte" },
  rewrite: { title: "Reformular i tornar a buscar", meta: "multi-query + HyDE", text: "L'LLM reformula la pregunta amb el vocabulari del DOGV i escriu un paràgraf hipotètic (HyDE). Amb totes les consultes es fa una segona passada i es fusiona amb la primera.",
    in: "pregunta original", out: "«autorització de sondeig de captació d'aigües, Figueroles» + document hipotètic" },
  ctx: { title: "Construir el context", meta: "5 fragments", text: "Els millors fragments es posen al principi i al final del prompt (els LLM aprofiten pitjor el que queda enmig) i es retallen al pressupost de context.",
    in: "fragments ordenats", out: "[1] … [2] … [3] …  context numerat per a citar" },
  llm: { title: "Generació", meta: "resposta", text: "L'LLM redacta la resposta només amb el context i cita cada afirmació amb el número del fragment. Si el context no ho diu, ha de dir que no ho sap.",
    in: "pregunta + context numerat", out: "El sondeig té una profunditat de 80 metres [1]." },
  agent: { title: "L'agent planifica", meta: "pas 1 · buscar", to: ["search"], text: "En lloc d'un flux fix, un LLM decidix què fer: buscar (amb quina consulta i filtres), llegir sencera una evidència o acabar.",
    in: "pregunta + observacions anteriors", out: "acció: search(«sondeig Figueroles»)" },
  search: { title: "Cerca de l'agent", meta: "híbrida", to: ["rerank"], text: "Cada cerca és la d'Advanced: BM25 i dens fusionats amb RRF, amb la consulta i els filtres que ha proposat l'agent.",
    in: "consulta de l'agent", out: "candidats" },
  obs: { title: "Evidències", meta: "E1 · E2 · E3", to: ["agent"], text: "Els resultats tornen a l'agent com a observacions numerades (E1, E2…). Amb elles decidix el pas següent.",
    in: "candidats reordenats", out: "E1: anunci de Figueroles · E2: … · E3: …" },
  read: { title: "Llegir una evidència sencera", meta: "E1", to: ["obs"], text: "Si una evidència és prometedora, l'agent la llig sencera (amb els fragments veïns) per a confirmar el detall que busca.",
    in: "E1", out: "text complet de l'anunci" },
};

// Recorrido de cada arquitectura: [nodo, cambios sobre la etapa base]
const TOURS = {
  naive: [["q"], ["embed"], ["dense"], ["ctx"], ["llm"]],
  hybrid: [["q"], ["embed"], ["tok"], ["dense"], ["bm25"], ["rrf"], ["cand"], ["ctx"], ["llm"]],
  advanced: [["q"], ["embed"], ["tok"], ["dense"], ["bm25"], ["rrf"], ["cand"], ["rerank"], ["ctx"], ["llm"]],
  corrective: [["q"], ["embed"], ["tok"], ["dense"], ["bm25"], ["rrf"], ["cand"], ["rerank"], ["gate"], ["rewrite"],
    ["gate", { meta: "correcte", variant: "done", to: ["ctx"], title: "Avaluador, segona passada",
      text: "Després de la segona passada, el millor candidat ja supera τ_ok: el retrieval és fiable i es continua cap a la resposta.",
      out: "veredicte: correcte" }],
    ["ctx"], ["llm"]],
  agentic: [["q"], ["agent"], ["search"], ["rerank", { to: ["obs"] }], ["obs"],
    ["agent", { meta: "pas 2 · llegir", to: ["read"], title: "L'agent decidix llegir", text: "E1 sembla l'anunci correcte, però el fragment no mostra la profunditat. L'agent decidix llegir-lo sencer.",
      out: "acció: read(E1)" }],
    ["read"], ["obs", { meta: "1 triada", to: ["ctx"], title: "L'agent tria les evidències", text: "Amb l'anunci sencer, l'agent acaba i tria quines evidències passen al context. Si no n'hi haguera cap de pertinent, s'abstindria.",
      out: "finish(E1)" }],
    ["ctx"], ["llm"]],
};

// Qué añade cada arquitectura respecto a la anterior y cuánto cuesta (reranker y llamadas al LLM por pregunta)
const ADDS = {
  naive: "La base: fragments de mida fixa, cerca per significat i generació.",
  hybrid: "Afig chunking per estructura, capçalera contextual i cerca lèxica BM25 fusionada amb RRF.",
  advanced: "Afig un reranker que rellig els candidats i reordena el context.",
  corrective: "Afig un avaluador: corregix el retrieval dubtós o s'absté.",
  agentic: "Un LLM agent decidix què buscar, què llegir i quan parar.",
};
const FACTS = {
  naive: { reranker: false, llm: "1" },
  hybrid: { reranker: false, llm: "1" },
  advanced: { reranker: true, llm: "1" },
  corrective: { reranker: true, llm: "1 – 3" },
  agentic: { reranker: true, llm: "1 per pas + 1" },
};

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

const CONCEPTS = [
  ["Bi-encoder vs cross-encoder", "El bi-encoder embebe consulta y documento por separado: se precalcula el índice y la búsqueda es un producto escalar. El cross-encoder los lee juntos con atención cruzada: mucho más preciso y mucho más caro, por eso solo reordena candidatos."],
  ["Léxico + semántico", "BM25 acierta con términos exactos (códigos de inserción, números de expediente, topónimos); el denso con paráfrasis y sinónimos. RRF los combina por posición, sin calibrar escalas distintas."],
  ["Chunking", "El tamaño fijo parte artículos por la mitad; el estructural respeta la jerarquía del texto legal y anota el apartado. La cabecera contextual hace que un chunk aislado «sepa» de qué disposición viene."],
  ["Lost in the middle", "Los LLM usan peor la información situada en medio de un contexto largo. Reordenar pone los fragmentos más relevantes en los extremos."],
  ["HyDE", "Se busca con el embedding de un documento hipotético escrito por el LLM, que se parece más a los documentos reales que la pregunta. Útil cuando la pregunta usa otro registro que el DOGV."],
  ["Abstención", "Un sistema que dice «no lo sé» cuando el retrieval es flojo es preferible en un dominio jurídico-administrativo: una respuesta inventada con cita oficial es peor que ninguna."],
];

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

const STEP_MS = 2800;

export function guideView(root) {
  let pipeline = store("guidePipeline") || "advanced";
  if (!TOURS[pipeline]) pipeline = "advanced";
  // sin reproducción automática si el sistema pide reducir el movimiento
  let step = 0, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches, timer = null, graph = null;

  // ---------- escalera: elegir arquitectura
  const ladder = h("div", { class: "arch-ladder", role: "group", "aria-label": t("Arquitectura") }, PIPE_ORDER.map((p, i) => {
    const card = h("button", { class: "arch-step", dataset: { p }, "aria-pressed": "false", onclick: () => select(p) },
      h("span", { class: "arch-num", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
      h("span", { class: "arch-name" }, h("span", { class: "dot", style: { background: PIPES[p].color } }), t(PIPES[p].label)),
      h("span", { class: "arch-adds" }, ADDS[p]),
      h("span", { class: "arch-facts" },
        h("span", {}, "Reranker ", h("b", {}, FACTS[p].reranker ? "sí" : "no")),
        h("span", {}, "LLM ", h("b", {}, FACTS[p].llm))));
    card.style.setProperty("--pc", PIPES[p].color);   // las variables CSS no se asignan con Object.assign(style)
    return card;
  }));

  // ---------- recorrido animado
  const box = h("div", { class: "pipe-wrap" });
  const counter = h("span", { class: "guide-counter" });
  const stepNum = h("span", { class: "guide-step-num", "aria-hidden": "true" });
  const dots = h("div", { class: "guide-dots", role: "group", "aria-label": t("Etapas") });
  const title = h("h3");
  const text = h("p");
  const ioIn = h("div", { class: "guide-io-val" });
  const ioOut = h("div", { class: "guide-io-val" });
  const playBtn = h("button", { class: "btn secondary sm", onclick: () => (playing ? pause() : play()) });
  const prevBtn = h("button", { class: "btn ghost sm", onclick: () => { pause(); go(step - 1); } }, icon("prev"), t("Anterior"));
  const nextBtn = h("button", { class: "btn ghost sm", onclick: () => { pause(); go(step + 1); } }, t("Siguiente"), icon("next"));
  const stepText = h("div", { class: "guide-step-text" }, stepNum, h("div", {}, h("div", { class: "eyebrow" }, counter), title, text));

  const stage = h("section", { class: "card guide", "aria-label": t("Recorrido animado") },
    h("div", { class: "guide-top" },
      h("div", { class: "guide-query" }, h("span", { class: "eyebrow" }, t("Pregunta de ejemplo")), h("span", { class: "guide-q" }, `«${QUERY}»`)),
      h("div", { class: "guide-controls" }, prevBtn, playBtn, nextBtn)),
    box,
    dots,
    h("div", { class: "guide-step" }, stepText,
      h("div", { class: "guide-io" },
        h("div", { class: "guide-io-box" }, h("div", { class: "eyebrow" }, t("Entra")), ioIn),
        h("div", { class: "guide-arrow", "aria-hidden": "true" }, "→"),
        h("div", { class: "guide-io-box" }, h("div", { class: "eyebrow" }, t("Sale")), ioOut))));

  // ---------- ficha técnica de la arquitectura elegida
  const sheet = h("section", { class: "card arch-sheet", "aria-label": t("Ficha técnica") });

  root.append(
    hero(6, "Arquitecturas", "Cómo *funciona* un RAG",
      t("Cinco arquitecturas, de la más simple a la más autónoma. Elige una y sigue una pregunta real del DOGV etapa a etapa.")),
    ladder,
    stage,
    sheet,
    h("div", { class: "section-title" }, h("h2", {}, t("Conceptos clave"))),
    h("div", { class: "concepts" }, CONCEPTS.map(([ti, tx]) => h("div", { class: "concept" }, h("h3", {}, t(ti)), h("p", {}, t(tx))))),
    h("details", { class: "fold" }, h("summary", {}, t("Propuestas para ampliar el estudio")),
      h("div", { class: "props" }, PROPOSALS.map(([ti, lvl, d, url]) =>
        h("div", { class: "prop" }, h("h4", {}, t(ti), h("span", { class: "tag" }, t(lvl))),
          h("p", {}, t(d), url ? [" ", h("a", { href: url, target: "_blank", rel: "noopener" }, "Paper ↗")] : null))))),
    h("details", { class: "fold" }, h("summary", {}, t("Referencias")),
      h("ol", { class: "refs" }, REFS.map(([ti, u, note]) => h("li", {}, ti, note ? ` (${t(note)})` : "", " ",
        h("a", { href: u, target: "_blank", rel: "noopener", "aria-label": t("Abrir referencia") }, "↗"))))),
  );

  function select(p) {
    pipeline = p;
    store("guidePipeline", p);
    graph = new PipelineGraph(box, p, PIPES[p].color);
    for (const el of [stage, sheet, root]) el.style.setProperty("--pc", PIPES[p].color);
    ladder.querySelectorAll(".arch-step").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === p));
    // si la escalera se desplaza en horizontal (pantallas estrechas), la arquitectura elegida queda a la vista
    const chosen = ladder.querySelector(`[data-p="${p}"]`);
    if (ladder.scrollWidth > ladder.clientWidth) ladder.scrollTo({ left: chosen.offsetLeft - 4, behavior: "smooth" });
    dots.replaceChildren(...TOURS[p].map(([id, over], i) => h("button", { "aria-label": over?.title || STAGES[id].title,
      title: over?.title || STAGES[id].title, onclick: () => { pause(); go(i); } })));
    const f = FAMILIES[p];
    sheet.replaceChildren(
      h("div", { class: "arch-sheet-head" }, h("div", { class: "eyebrow" }, t("Ficha técnica")), h("h3", {}, t(f.title)), h("p", {}, t(f.lead))),
      h("ul", { class: "arch-points" }, f.points.map((x) => h("li", {}, t(x)))),
      h("div", { class: "formula", translate: "no" }, t(f.formula)));
    go(0);
    if (playing) schedule();
  }

  /** Pinta el grafo hasta la etapa `i`: las anteriores sin partículas, la actual animada y enfocada. */
  function go(i) {
    const tour = TOURS[pipeline];
    step = Math.max(0, Math.min(tour.length - 1, i));
    graph.reset();
    tour.slice(0, step + 1).forEach(([id, over], k) => {
      const s = { ...STAGES[id], ...over };
      graph.done(id, s.meta || "", null, { particles: k === step, variant: s.variant, to: s.to });
    });
    graph.focus(tour[step][0]);
    // en pantallas estrechas el grafo se desplaza en horizontal: se centra la etapa actual
    const node = graph.nodeEls[tour[step][0]]?.getBoundingClientRect(), wrap = box.getBoundingClientRect();
    if (node && box.scrollWidth > box.clientWidth) {
      box.scrollBy({ left: node.left + node.width / 2 - (wrap.left + wrap.width / 2), behavior: "smooth" });
    }
    const s = { ...STAGES[tour[step][0]], ...tour[step][1] };
    // al avanzar a mano, el lector de pantalla lee la etapa; en reproducción automática no, para no saturar
    stepText.setAttribute("aria-live", playing ? "off" : "polite");
    stepNum.textContent = String(step + 1);
    counter.textContent = t("Etapa {n} de {m}", { n: step + 1, m: tour.length });
    title.textContent = s.title;
    text.textContent = s.text;
    ioIn.textContent = s.in;
    ioOut.textContent = s.out;
    [...dots.children].forEach((d, k) => {
      d.classList.toggle("done", k < step);
      d.classList.toggle("active", k === step);
      if (k === step) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current");
    });
    prevBtn.disabled = step === 0;
    nextBtn.disabled = step === tour.length - 1;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!root.isConnected) return;
      if (step < TOURS[pipeline].length - 1) { go(step + 1); schedule(); } else pause();
    }, STEP_MS);
  }
  function play() {
    playing = true;
    if (step === TOURS[pipeline].length - 1) go(0);
    schedule();
    paintPlay();
  }
  function pause() { playing = false; clearTimeout(timer); paintPlay(); }
  const paintPlay = () => playBtn.replaceChildren(icon(playing ? "pause" : "play"), playing ? t("Pausa") : t("Reproducir"));

  // flechas del teclado para avanzar o retroceder etapas (salvo si el foco está en un campo de texto)
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "ArrowRight") { pause(); go(step + 1); }
    if (e.key === "ArrowLeft") { pause(); go(step - 1); }
  };
  addEventListener("keydown", onKey);

  paintPlay();
  select(pipeline);
  return { destroy: () => { clearTimeout(timer); removeEventListener("keydown", onKey); } };
}
