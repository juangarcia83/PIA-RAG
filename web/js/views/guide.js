// Cómo funciona: recorrido guiado y animado, etapa a etapa, de cada arquitectura con una consulta de ejemplo.
// Los textos del recorrido están escritos directamente en valenciano (la interfaz solo está en valenciano); los
// controles pasan por t() como en el resto de vistas. Los valores de «entra» y «ix» son ilustrativos.
import { h, hero, icon, seg, store, PIPES, PIPE_ORDER } from "../ui.js";
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

// Qué añade cada arquitectura respecto a la anterior
const ADDS = {
  naive: "La base: fragments de mida fixa, cerca per significat i generació.",
  hybrid: "Afig chunking per estructura, capçalera contextual i cerca lèxica BM25 fusionada amb RRF.",
  advanced: "Afig un reranker que rellig els candidats i reordena el context.",
  corrective: "Afig un avaluador: corregix el retrieval dubtós o s'absté.",
  agentic: "Un LLM agent decidix què buscar, què llegir i quan parar.",
};

const STEP_MS = 2800;

export function guideView(root) {
  let pipeline = store("guidePipeline") || "advanced";
  if (!TOURS[pipeline]) pipeline = "advanced";
  // sin reproducción automática si el sistema pide reducir el movimiento
  let step = 0, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches, timer = null, graph = null;

  const box = h("div", { class: "pipe-wrap" });
  const counter = h("span", { class: "guide-counter" });
  const dots = h("div", { class: "guide-dots", role: "tablist", "aria-label": t("Etapas") });
  const title = h("h3");
  const text = h("p");
  const ioIn = h("div", { class: "guide-io-val" });
  const ioOut = h("div", { class: "guide-io-val" });
  const adds = h("p", { class: "guide-adds" });
  const playBtn = h("button", { class: "btn secondary sm", onclick: () => (playing ? pause() : play()) });
  const prevBtn = h("button", { class: "btn ghost sm", "aria-label": t("Anterior"), onclick: () => { pause(); go(step - 1); } }, icon("prev"), t("Anterior"));
  const nextBtn = h("button", { class: "btn ghost sm", "aria-label": t("Siguiente"), onclick: () => { pause(); go(step + 1); } }, t("Siguiente"), icon("next"));

  const pipeSeg = seg(PIPE_ORDER.map((p) => [p, t(PIPES[p].label)]), pipeline, (v) => select(v),
    { colors: Object.fromEntries(PIPE_ORDER.map((p) => [p, PIPES[p].color])) });

  const stage = h("div", { class: "card guide" },
    h("div", { class: "guide-top" }, pipeSeg, h("div", { class: "guide-controls" }, prevBtn, playBtn, nextBtn)),
    adds,
    box,
    dots,
    h("div", { class: "guide-step" },
      h("div", {}, h("div", { class: "eyebrow" }, counter), title, text),
      h("div", { class: "guide-io" },
        h("div", {}, h("div", { class: "eyebrow" }, t("Entra")), ioIn),
        h("div", { class: "guide-arrow", "aria-hidden": "true" }, "↓"),
        h("div", {}, h("div", { class: "eyebrow" }, t("Sale")), ioOut))));

  const overview = h("div", { class: "guide-overview" }, PIPE_ORDER.map((p) => {
    const card = h("button", { class: "card guide-family", dataset: { p }, onclick: () => { pipeSeg.set(p); select(p); stage.scrollIntoView({ behavior: "smooth", block: "start" }); } },
      h("span", { class: "dot", style: { background: PIPES[p].color } }), h("b", {}, t(PIPES[p].label)), h("span", {}, ADDS[p]));
    card.style.setProperty("--pc", PIPES[p].color);   // las variables CSS no se asignan con Object.assign(style)
    return card;
  }));

  root.append(
    hero(6, "Cómo funciona", "Cómo *funciona* un RAG",
      t("Sigue una pregunta real del DOGV etapa a etapa y mira qué hace cada arquitectura con ella.")),
    h("div", { class: "guide-query" }, h("span", { class: "eyebrow" }, t("Pregunta de ejemplo")), h("span", {}, `«${QUERY}»`)),
    stage,
    h("div", { class: "section-title" }, h("h2", {}, t("Qué añade cada arquitectura"))),
    overview,
  );

  function select(p) {
    pipeline = p;
    store("guidePipeline", p);
    graph = new PipelineGraph(box, p, PIPES[p].color);
    stage.style.setProperty("--pc", PIPES[p].color);
    adds.textContent = ADDS[p];
    overview.querySelectorAll(".guide-family").forEach((b) => b.classList.toggle("active", b.dataset.p === p));
    dots.replaceChildren(...TOURS[p].map(([id, over], i) => h("button", { role: "tab", "aria-label": (over?.title || STAGES[id].title),
      title: over?.title || STAGES[id].title, onclick: () => { pause(); go(i); } })));
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
    const s = { ...STAGES[tour[step][0]], ...tour[step][1] };
    counter.textContent = t("Etapa {n} de {m}", { n: step + 1, m: tour.length });
    title.textContent = s.title;
    text.textContent = s.text;
    ioIn.textContent = s.in;
    ioOut.textContent = s.out;
    [...dots.children].forEach((d, k) => { d.classList.toggle("done", k < step); d.classList.toggle("active", k === step); });
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
