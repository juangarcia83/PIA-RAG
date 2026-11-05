// Preguntar: ejecuta una arquitectura en streaming y enseña cada etapa mientras ocurre.
import { cached, getJSON, postJSON, streamRun, uploadAttachment } from "../api.js";
import { h, hero, icon, seg, esc, fmtMs, fmtScore, fmtNum, fmtDate, short, bindTip, chunkTip, renderAnswer, toast, store, PIPES, PIPE_ORDER, sleep } from "../ui.js";
import { t } from "../i18n.js";
import { PipelineGraph } from "../viz/pipeline.js";
import { RankFlow } from "../viz/flow.js";
import { scatter, barsH, legend, diverging } from "../viz/charts.js";
import { SemanticMap } from "../viz/map.js";
import { Constellation } from "../viz/constellation.js";
import { openDocAtText } from "./docsheet.js";
import { describe } from "../narrate.js";
import { stagger } from "../motion.js";

/** Preguntas de ejemplo de Comparar: cada una tiene respuesta en la muestra del DOGV (28/10/2026 – 03/11/2026). */
export const EXAMPLES = [
  "Quines festes han rebut la declaració d'interés turístic?",
  "Quina profunditat té el sondeig d'aigües subterrànies autoritzat a Figueroles?",
  "Quantes places d'agent de la Policia Local convoca l'Ajuntament de Borriana?",
  "Quines ajudes hi ha per a comprar vivenda en municipis de fins a 10.000 habitants?",
  "Quines mesures establix el Decret llei 8/2026 per a respondre als danys de la dana?",
  "Quin termini hi ha per a presentar instàncies a la plaça de lampista d'Alaquàs?",
];

const TIMING_COLORS = { retrieval: "var(--c-naive)", rerank: "var(--c-advanced)", query_rewriting: "var(--c-hybrid)",
  second_pass: "#8e6bd8", planning: "var(--c-agentic)", generation: "var(--c-corrective)" };
const TIMING_LABELS = { retrieval: "Retrieval", rerank: "Reranking", query_rewriting: "Reformulación", second_pass: "2ª pasada", planning: "Planificación (agente)", generation: "Generación" };
const VERDICTS = { correct: "correcto", ambiguous: "ambiguo", incorrect: "abstención" };
const CHAT_TURNS = 20;     // turnos de conversación guardados en el navegador
const CHAT_HISTORY = 4;    // turnos anteriores que se envían con cada pregunta
const ATTACH_ACCEPT = ".pdf,.docx,.txt,.md";
const ATTACH_MAX = 3;      // documentos adjuntos por conversación (el servidor admite 3 por pregunta)

// ------------------------------------------------------------------ piezas reutilizables
export function timingBar(timings) {
  timings = Object.fromEntries(Object.entries(timings).filter(([, v]) => v >= 1));
  const total = Object.values(timings).reduce((a, b) => a + b, 0) || 1;
  const label = (k) => t(TIMING_LABELS[k] || k);
  return h("div", {},
    h("div", { class: "timing-bar" }, Object.entries(timings).map(([k, v]) => {
      const span = h("span", { style: { width: `${(v / total) * 100}%`, background: TIMING_COLORS[k] || "var(--muted)" } });
      bindTip(span, `<b>${label(k)}</b><br>${fmtMs(v)} · ${Math.round((v / total) * 100)}%`);
      return span;
    })),
    legend(Object.entries(timings).map(([k, v]) => [`${label(k)} ${fmtMs(v)}`, TIMING_COLORS[k] || "var(--muted)"])));
}

export function sourceCard(c, color, { compact = false, chunker = "advanced" } = {}) {
  const text = h("div", { class: "src-text", translate: "no" }, c.text);
  const scores = Object.entries(c.scores || {}).filter(([k]) => ["dense", "bm25", "rrf", "rerank"].includes(k));
  const maxOf = { dense: 1, rerank: 1, rrf: 0.04, bm25: Math.max(...scores.filter(([k]) => k === "bm25").map(([, v]) => v), 1) };
  const card = h("div", { class: "src", id: `src-${c.n}`, dataset: { n: c.n } },
    h("div", { class: "src-head" },
      h("span", { class: "src-n" }, c.n),
      h("div", { style: { minWidth: 0, flex: 1 } },
        h("div", { class: "src-title", translate: "no" }, short(c.title || t("(sin título)"), compact ? 120 : 220)),
        h("div", { class: "src-meta" }, h("span", { class: "mono" }, c.code), h("span", {}, fmtDate(c.date)), h("span", {}, short(c.organismo, 48)),
          c.rank && !compact ? h("span", {}, `rank #${c.rank}`) : null))),
    compact ? null : h("div", { class: "scorebars" }, scores.map(([k, v]) => [
      h("span", {}, { dense: t("Denso"), bm25: "BM25", rrf: "RRF", rerank: "Reranker" }[k]),
      h("div", { class: "bar" }, h("span", { style: { width: `${Math.min(100, (v / maxOf[k]) * 100)}%`, background: color } })),
      h("span", { class: "v" }, fmtScore(v, k === "rrf" ? 4 : 3)),
    ])),
    compact ? null : (c.section ? h("div", { class: "tiny muted", style: { marginTop: "6px" } }, "§ ", c.section) : null),
    compact ? null : text,
    h("div", { class: "src-actions" },
      compact ? null : h("button", { class: "btn ghost sm", onclick: (e) => { text.classList.toggle("open"); e.currentTarget.textContent = text.classList.contains("open") ? t("Ver menos") : t("Ver fragmento"); } }, t("Ver fragmento")),
      h("button", { class: "btn ghost sm", onclick: () => openDocAtText(c.doc, c.text, chunker) }, t("Abrir disposición")),
      c.url ? h("a", { class: "btn ghost sm", href: c.url, target: "_blank", rel: "noopener" }, "PDF ↗") : null),
  );
  return card;
}

function linkCitations(root, sourcesEl) {
  root.querySelectorAll(".cite").forEach((el) => {
    const n = el.dataset.n;
    const target = () => sourcesEl.querySelector(`[data-n="${n}"]`);
    el.addEventListener("mouseenter", () => target()?.classList.add("hl"));
    el.addEventListener("mouseleave", () => target()?.classList.remove("hl"));
    el.addEventListener("click", () => target()?.scrollIntoView({ behavior: "smooth", block: "center" }));
  });
}

// ------------------------------------------------------------------ fuentes en ventana emergente (chat)
// En el chat las fuentes no se listan al final: cada cita [n] abre su ficha al pasar el ratón, al pulsarla o con el
// teclado. Una sola ventana para toda la página, que se queda abierta mientras el ratón está encima.
let citePop = null, citeTimer = 0, citeAnchor = null;

function citePopovers(root, contexts, chunker, attachments = []) {
  // fuentes del DOGV por número y fragmentos de documentos adjuntos por referencia (D1, D2…)
  const byN = Object.fromEntries([...contexts.map((c) => [String(c.n), c]),
    ...attachments.map((b) => [b.ref, { n: b.ref, title: b.name, page: b.page, text: b.text, attachment: true }])]);
  root.querySelectorAll(".cite").forEach((el) => {
    const c = byN[el.dataset.n];
    if (!c) return;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", t("Fuente {n}: {title}", { n: c.n, title: short(c.title || "", 90) }));
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("aria-controls", "cite-pop");
    const open = () => showCite(el, c, chunker);
    el.addEventListener("mouseenter", open);
    el.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    el.addEventListener("mouseleave", hideCiteSoon);
    // con el teclado, Intro o Espacio abren la ficha y llevan el foco a su primer botón
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
      citePop.querySelector("button, a")?.focus();
    });
  });
}

function showCite(anchor, c, chunker) {
  clearTimeout(citeTimer);
  if (!citePop) {
    citePop = h("div", { class: "cite-pop", id: "cite-pop", role: "dialog" });
    citePop.addEventListener("mouseenter", () => clearTimeout(citeTimer));
    citePop.addEventListener("mouseleave", hideCiteSoon);
    citePop.addEventListener("focusout", (e) => { if (!citePop.contains(e.relatedTarget) && e.relatedTarget !== citeAnchor) hideCiteSoon(); });
    document.body.append(citePop);
    addEventListener("scroll", () => { if (!citePop.contains(document.activeElement)) hideCite(); }, { passive: true });
    addEventListener("hashchange", () => hideCite());
    document.addEventListener("click", (e) => { if (!citePop.contains(e.target)) hideCite(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && citePop.classList.contains("show")) hideCite(true); });
  }
  if (citeAnchor !== anchor) citeAnchor?.setAttribute("aria-expanded", "false");
  citeAnchor?.classList.remove("on");
  citeAnchor = anchor;
  anchor.classList.add("on");
  anchor.setAttribute("aria-expanded", "true");
  citePop.setAttribute("aria-label", t("Fuente {n}", { n: c.n }));
  citePop.replaceChildren(
    h("div", { class: "cite-pop-head" }, h("span", { class: "src-n", "aria-hidden": "true" }, c.n),
      h("div", { class: "src-title", translate: "no" }, short(c.title || t("(sin título)"), 170)),
      h("button", { class: "icon-btn cite-pop-close", "aria-label": t("Cerrar"), onclick: () => hideCite(true) }, icon("close"))),
    c.attachment
      ? h("div", { class: "src-meta" }, h("span", {}, t("Documento adjunto")), c.page ? h("span", {}, t("pág. {n}", { n: c.page })) : null)
      : h("div", { class: "src-meta" }, h("span", { class: "mono" }, c.code), h("span", {}, fmtDate(c.date)), h("span", {}, short(c.organismo, 48))),
    h("p", { class: "cite-pop-text", translate: "no", tabindex: 0 }, citeExcerpt(c)),
    c.attachment ? null : h("div", { class: "src-actions" },
      h("button", { class: "btn ghost sm", onclick: () => { hideCite(); openDocAtText(c.doc, c.text, chunker); } }, t("Abrir disposición")),
      c.url ? h("a", { class: "btn ghost sm", href: c.url, target: "_blank", rel: "noopener" }, "PDF ↗", h("span", { class: "sr-only" }, t("(se abre en otra pestaña)"))) : null));
  citePop.classList.add("show");
  // encima de la cita si cabe; si no, debajo
  const r = anchor.getBoundingClientRect(), w = citePop.offsetWidth, ht = citePop.offsetHeight;
  const top = r.top - ht - 10 > 76 ? r.top - ht - 10 : r.bottom + 10;
  citePop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  citePop.style.top = `${top}px`;
}

/** Texto del fragmento sin encabezados Markdown ni el título (que ya está en la ficha). */
function citeExcerpt(c) {
  const title = (c.title || "").slice(0, 40);
  const body = c.text.split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !(title && l.startsWith(title)) && !/^(Títol|Apartat|Título|Apartado):/.test(l));
  return short(body.join(" ").replace(/\s+/g, " "), 320);
}

function hideCiteSoon() { clearTimeout(citeTimer); citeTimer = setTimeout(() => hideCite(), 220); }
/** Cierra la ficha; con `refocus`, devuelve el foco a la cita (al cerrar con Esc desde dentro). */
function hideCite(refocus = false) {
  clearTimeout(citeTimer);
  const back = refocus && citePop?.contains(document.activeElement) ? citeAnchor : null;
  citePop?.classList.remove("show");
  citeAnchor?.classList.remove("on");
  citeAnchor?.setAttribute("aria-expanded", "false");
  citeAnchor = null;
  back?.focus();
}

// ------------------------------------------------------------------ vista
export function askView(root, state, { restore = false } = {}) {
  const st = state.status;
  let pipeline = store("pipeline") || "advanced";
  if (!st.pipelines[pipeline]) pipeline = "advanced";
  let generate = store("generate") ?? true;
  const filters = {};
  let options = {};
  let controller = null;

  // ---------- cabecera y búsqueda
  const ta = h("textarea", { rows: 1, placeholder: t("Pregunta lo que quieras sobre el DOGV…"), "aria-label": t("Pregunta") });
  const go = h("button", { class: "search-go", "aria-label": t("Preguntar"), disabled: true }, icon("up"));
  const autosize = () => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ta.style.overflowY = ta.scrollHeight > 180 ? "auto" : "hidden";   // barra de desplazamiento solo si no cabe (max-height)
    go.disabled = !ta.value.trim();
  };
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  go.addEventListener("click", () => submit());
  // modelo del modo simple, junto al botón de enviar: «Estándar» (Naive) o «Avanzado» (Advanced, por defecto)
  let stdModel = store("stdModel") === "naive" ? "naive" : "advanced";
  const modelPick = seg([["naive", t("Estándar")], ["advanced", t("Avanzado")]], stdModel, (v) => { stdModel = v; store("stdModel", v); });
  modelPick.classList.add("model-pick", "std-only");
  modelPick.setAttribute("aria-label", t("Modelo"));

  // ---------- documentos adjuntos (modo simple): botón «+», etiquetas y arrastrar y soltar sobre la caja
  // Los documentos son de la conversación: se envían con cada pregunta hasta que se quitan o se empieza otra. Al volver
  // al inicio con una conversación guardada, sus documentos quedan aparcados (`parked`) y no se ven: lo que se adjunte
  // ahí es para una conversación nueva. «Retomarla» los recupera; una pregunta nueva los descarta con la conversación.
  const valid = (list) => (list || []).filter((a) => a.id);
  const parkedAtStart = (store("chat") || []).length > 0 && store("chatOpen") === false;
  let attachments = valid(parkedAtStart ? store("draftAttachments") : store("chatAttachments"));   // los visibles
  let parked = parkedAtStart ? valid(store("chatAttachments")) : [];                                // los aparcados
  const fileInput = h("input", { type: "file", accept: ATTACH_ACCEPT, multiple: true, class: "sr-only", tabindex: -1,
    "aria-hidden": "true", onchange: (e) => { addFiles([...e.target.files]); e.target.value = ""; } });
  const attachBtn = h("button", { type: "button", class: "attach-btn std-only", title: t("Adjuntar un documento (PDF, DOCX o TXT)"),
    "aria-label": t("Adjuntar un documento (PDF, DOCX o TXT)"), onclick: () => fileInput.click() }, icon("plus"));
  const attachRow = h("div", { class: "attach-row std-only hidden", role: "group", "aria-label": t("Documentos adjuntos") });
  function saveAttachments() {
    const ready = attachments.filter((a) => !a.busy);
    const isParked = !sessionOpen && thread.childElementCount > 0;
    store("chatAttachments", isParked ? parked : ready);
    store("draftAttachments", isParked ? ready : []);
  }
  // borra del servidor los documentos de una conversación que se descarta
  const dropAttachments = (list) => list.forEach((a) => a.id && fetch(`/api/attachments/${a.id}`, { method: "DELETE" }).catch(() => {}));
  function paintAttachments() {
    attachRow.classList.toggle("hidden", !attachments.length);
    attachRow.replaceChildren(
      ...attachments.map((a) => h("span", { class: `att-chip${a.busy ? " busy" : ""}` },
        a.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("doc"),
        h("span", { class: "att-name", title: a.name }, short(a.name, 42)),
        h("span", { class: "att-meta" }, a.busy ? t("Procesando…") : a.pages ? t("{n} pág.", { n: a.pages }) : ""),
        a.busy ? null : h("button", { type: "button", class: "att-x", "aria-label": t("Quitar «{name}»", { name: a.name }),
          onclick: () => removeAttachment(a) }, icon("close")))),
      h("span", { class: "att-note" }, t("El texto de los documentos se envía al modelo generativo para responder.")));
  }
  async function addFiles(files) {
    for (const file of files) {
      if (attachments.length >= ATTACH_MAX) { toast(t("Como máximo {n} documentos por conversación.", { n: ATTACH_MAX })); break; }
      const tmp = { name: file.name, busy: true };
      attachments.push(tmp);
      paintAttachments();
      try {
        Object.assign(tmp, await uploadAttachment(file), { busy: false });
      } catch (e) {
        attachments = attachments.filter((a) => a !== tmp);
        toast(e.message);
      }
      paintAttachments();
      saveAttachments();
    }
  }
  function removeAttachment(a) {
    attachments = attachments.filter((x) => x !== a);
    dropAttachments([a]);
    paintAttachments();
    saveAttachments();
  }
  // los guardados en el navegador pueden haberse perdido si el servidor se ha reiniciado
  for (const a of [...attachments, ...parked]) {
    getJSON(`/api/attachments/${a.id}`).catch(() => {
      attachments = attachments.filter((x) => x !== a);
      parked = parked.filter((x) => x !== a);
      paintAttachments();
      saveAttachments();
      toast(t("«{name}» ya no está en el servidor: vuelve a adjuntarlo.", { name: a.name }));
    });
  }
  paintAttachments();

  const searchBox = h("div", { class: "search-box" }, attachBtn, ta, modelPick, go, fileInput);
  for (const [type, on] of [["dragenter", true], ["dragover", true], ["dragleave", false], ["drop", false]]) {
    searchBox.addEventListener(type, (e) => {
      if (mode !== "standard" || !e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      searchBox.classList.toggle("drop", on);
      if (type === "drop") addFiles([...e.dataTransfer.files]);
    });
  }

  const pipeSeg = seg(PIPE_ORDER.map((p) => [p, t(PIPES[p].label)]), pipeline, (v) => { pipeline = v; store("pipeline", v); options = {}; paintSettings(); paintPipeHint(); },
    { colors: Object.fromEntries(PIPE_ORDER.map((p) => [p, PIPES[p].color])) });
  pipeSeg.setAttribute("aria-label", t("Arquitectura"));
  const genSwitch = h("input", { type: "checkbox", checked: generate && st.llm.available, disabled: !st.llm.available, onchange: (e) => { generate = e.target.checked; store("generate", generate); } });
  const filterBtn = h("button", { class: "btn secondary sm", onclick: () => togglePanel(filterPanel) }, icon("filter"), t("Filtros"));
  const settingsBtn = h("button", { class: "btn secondary sm", onclick: () => togglePanel(settingsPanel) }, icon("sliders"), t("Parámetros"));
  const pipeHint = h("div", { class: "small muted adv-only", style: { maxWidth: "980px", margin: "10px auto 0", minHeight: "20px" } });
  const paintPipeHint = () => { pipeHint.textContent = t(st.info[pipeline].summary); };
  paintPipeHint();

  const filterPanel = h("div", { class: "panel hidden adv-only" });
  const settingsPanel = h("div", { class: "panel hidden adv-only" });

  // modo simple (solo la pregunta y el modelo) o experto (arquitecturas, generación, filtros y parámetros)
  let mode = store("askMode") === "advanced" ? "advanced" : "standard";
  const modeSeg = seg([["standard", t("Simple")], ["advanced", t("Experto")]], mode, (v) => setMode(v));
  /** Cambia de modo y, si ya hay una ejecución en pantalla, la vuelve a pintar con el formato del nuevo modo. */
  const setMode = (v) => {
    mode = v;
    store("askMode", v);
    modeSeg.set(v);
    paintMode();
    paintChat();
    if (v === "advanced" && state.lastRun?.result) replayRun(state.lastRun);
  };
  modeSeg.classList.add("mode-seg");
  modeSeg.setAttribute("aria-labelledby", "mode-label");
  const paintMode = () => {
    root.classList.toggle("mode-standard", mode === "standard");
    if (mode === "standard") [filterPanel, settingsPanel].forEach((x) => x.classList.add("hidden"));
  };
  paintMode();
  const togglePanel = (p) => {
    const show = p.classList.contains("hidden");
    [filterPanel, settingsPanel].forEach((x) => x.classList.add("hidden"));
    if (show) p.classList.remove("hidden");
  };

  // filtros por metadatos
  cached("/api/corpus").then((c) => {
    const uniq = (k) => [...new Set(c.docs.map((d) => d[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const select = (key, values, label) => {
      const sel = h("select", { class: "input", onchange: (e) => { filters[key] = e.target.value || null; paintFilterBtn(); } },
        h("option", { value: "" }, t("Todos")), values.map((v) => h("option", { value: v }, short(v, 60))));
      return h("div", { class: "field" }, h("label", {}, label), sel);
    };
    const dates = uniq("date");
    const date = (key, label) => h("div", { class: "field" }, h("label", {}, label),
      h("input", { class: "input", type: "date", min: dates[0], max: dates.at(-1), onchange: (e) => { filters[key] = e.target.value || null; paintFilterBtn(); } }));
    filterPanel.append(
      select("organismo", uniq("organismo"), t("Organismo")),
      select("seccion", uniq("seccion"), t("Sección")),
      date("date_from", t("Desde")), date("date_to", t("Hasta")),
      select("dogv_num", [...new Set(c.docs.map((d) => String(d.num)))].sort(), t("Nº de DOGV")),
      h("p", { class: "note" }, t("Los filtros se aplican antes de buscar (prefiltrado): el retrieval solo ve los chunks que cumplen las condiciones.")));
  });
  const paintFilterBtn = () => {
    const n = Object.values(filters).filter(Boolean).length;
    filterBtn.replaceChildren(icon("filter"), n ? t("Filtros · {n}", { n }) : t("Filtros"));
    filterBtn.classList.toggle("secondary", !n);
  };

  // parámetros ajustables
  const SPEC = [
    ["top_k", "Fragmentos al LLM (top-k)", 1, 10, 1, "all"],
    ["max_context_chars", "Presupuesto de contexto (car.)", 2000, 24000, 1000, "all"],
    ["dense_weight", "Peso rama densa (RRF)", 0, 2, 0.1, "hyb"],
    ["sparse_weight", "Peso rama BM25 (RRF)", 0, 2, 0.1, "hyb"],
    ["rrf_k", "Constante k de RRF", 1, 120, 1, "hyb"],
    ["k_candidates", "Candidatos al reranker", 5, 50, 1, "rr"],
    ["window", "Chunks vecinos (small-to-big)", 0, 2, 1, "hyb"],
    ["tau_ok", "τ_ok (retrieval correcto)", 0, 1, 0.05, "crag"],
    ["tau_abstain", "τ_abstain (abstención)", 0, 0.5, 0.01, "crag"],
    ["n_rewrites", "Reformulaciones", 1, 5, 1, "crag"],
    ["max_steps", "Pasos máximos del agente", 1, 8, 1, "agent"],
  ];
  const applies = (scope) => scope === "all" || (scope === "hyb" && pipeline !== "naive") || (scope === "rr" && ["advanced", "corrective", "agentic"].includes(pipeline)) || (scope === "crag" && pipeline === "corrective") || (scope === "agent" && pipeline === "agentic");
  function paintSettings() {
    const cfg = st.pipelines[pipeline];
    settingsPanel.replaceChildren();
    for (const [key, label, min, max, step, scope] of SPEC) {
      if (!applies(scope) || cfg[key] === undefined) continue;
      const val = h("span", { class: "range-val" }, options[key] ?? cfg[key]);
      const input = h("input", { type: "range", min, max, step, value: options[key] ?? cfg[key], oninput: (e) => {
        options[key] = Number(e.target.value); val.textContent = e.target.value; } });
      settingsPanel.append(h("div", { class: "field" }, h("label", {}, t(label)), h("div", { class: "range-row" }, input, val)));
    }
    const bools = [["reorder", "Reordenar (lost in the middle)", "hyb"], ["use_hyde", "Usar HyDE", "crag"]];
    for (const [key, label, scope] of bools) {
      if (!applies(scope) || cfg[key] === undefined) continue;
      settingsPanel.append(h("label", { class: "switch" }, h("input", { type: "checkbox", checked: options[key] ?? cfg[key], onchange: (e) => { options[key] = e.target.checked; } }), t(label)));
    }
    settingsPanel.append(
      h("p", { class: "note" }, t("Los cambios solo afectan a tus consultas desde esta página; no modifican la configuración del notebook."), " ",
        h("button", { class: "btn ghost sm", onclick: () => { options = {}; paintSettings(); toast(t("Parámetros restablecidos")); } }, t("Restablecer"))));
  }
  paintSettings();

  // preguntas recientes, solo en modo experto (en el simple ya están en la conversación)
  const history = store("history") || [];
  const recent = history.length ? h("div", { class: "chips suggest adv-only", style: { marginTop: "14px" } },
    h("span", { class: "tiny muted", style: { alignSelf: "center" } }, t("Recientes:")),
    history.slice(0, 5).map((q) => h("button", { class: "chip", onclick: () => { ta.value = q; autosize(); submit(); } }, short(q, 60)))) : null;

  const results = h("div", { class: "adv-only" });   // panel completo de la última ejecución (modo experto)

  // conversación del modo simple: se guarda en el navegador y cada pregunta se envía con los turnos anteriores
  let chat = store("chat") || [];   // [{ question, pipeline, run_id, result }]
  // el hilo es un registro: los lectores de pantalla anuncian cada respuesta nueva
  const thread = h("div", { class: "chat-thread std-only", role: "log", "aria-live": "polite", "aria-label": t("Conversación") });
  // una conversación es una «sesión» a pantalla completa (sin menú, modo ni pie); «Inicio» la cierra sin borrarla
  let sessionOpen = store("chatOpen") ?? true;
  // barra fija de la sesión: volver al inicio, cuántas preguntas lleva y empezar otra
  const chatCount = h("span", { class: "chat-bar-title" });
  const chatBar = h("div", { class: "chat-bar chat-only" },
    h("button", { class: "btn ghost sm", onclick: () => closeSession() }, icon("prev"), t("Inicio")),
    chatCount,
    h("button", { class: "btn secondary sm", onclick: () => newChat() }, icon("plus"), h("span", { class: "label" }, t("Nueva conversación"))));
  // en la pantalla inicial, si hay una conversación guardada, se ofrece retomarla
  const resumeCount = h("span");
  const resumeBar = h("div", { class: "resume-bar", role: "region", "aria-label": t("Conversación guardada") },
    icon("chat"), resumeCount,
    h("button", { class: "btn secondary sm", onclick: () => openSession() }, t("Retomarla")),
    h("button", { class: "btn ghost sm", onclick: () => newChat() }, t("Nueva conversación")),
    h("span", { class: "resume-hint" }, t("Si escribes una pregunta, empezará una conversación nueva y esta se descartará.")));

  // la constelación usa la proyección real del índice avanzado
  const artCanvas = h("canvas", { "aria-hidden": "true" });
  const artCaption = h("figcaption", {}, t("cargando el espacio semántico…"));
  const art = h("figure", { class: "hero-art" }, artCanvas, artCaption);
  let constellation = null;
  cached("/api/map/advanced").then((d) => {
    if (!artCanvas.isConnected) return;
    constellation = new Constellation(artCanvas, d);
    artCaption.textContent = t("{n} fragmentos reales · consulta y 6 vecinos", { n: fmtNum(d.n) });
  }).catch(() => art.remove());
  const heroEl = hero(1, "Preguntar", "Pregunta al *DOGV*",
    t("Mira cómo cada arquitectura RAG busca, filtra y razona sobre las disposiciones del {from} al {to}.", {
      from: fmtDate(st.corpus.dates[0]), to: fmtDate(st.corpus.dates[1]) }),
    art);
  // el modo se elige en la pantalla inicial: durante una conversación no se ve
  heroEl.querySelector(".hero-text").append(h("div", { class: "mode-row" },
    h("span", { class: "mode-label", id: "mode-label" }, t("Modo")), modeSeg,
    h("span", { class: "mode-hint" }, t("Simple: chat con respuestas y fuentes · Experto: arquitecturas, filtros, parámetros y el proceso completo"))));
  root.append(
    heroEl,
    chatBar, thread,
    // en una conversación, la caja de pregunta queda fija abajo, como en un chat
    h("div", { class: "composer" },
      attachRow,
      h("div", { class: "search" }, searchBox),
      resumeBar,
      h("div", { class: "toolbar adv-only" }, pipeSeg,
        h("label", { class: "switch", title: st.llm.available ? "" : t("Conecta un LLM desde el botón de la barra superior") }, genSwitch, st.llm.available ? t("Generar respuesta") : t("Sin LLM · solo retrieval")),
        filterBtn, settingsBtn),
      pipeHint, filterPanel, settingsPanel),
    recent, results,
  );
  chat.forEach((turn) => renderStoredTurn(turn));
  paintChat();
  if (!restore) setTimeout(() => ta.focus(), 50);

  // ---------- conversación (modo simple)
  function paintChat() {
    const n = thread.childElementCount;
    const chatting = mode === "standard" && n > 0 && sessionOpen;
    root.classList.toggle("chatting", chatting);
    // en sesión se ocultan el menú de secciones y el pie de toda la página
    document.body.classList.toggle("chat-session", chatting);
    chatCount.textContent = n === 1 ? t("Conversación · 1 pregunta") : t("Conversación · {n} preguntas", { n });
    resumeCount.textContent = n === 1 ? t("Tienes una conversación con 1 pregunta") : t("Tienes una conversación con {n} preguntas", { n });
    resumeBar.classList.toggle("hidden", !(mode === "standard" && n > 0 && !sessionOpen));
    ta.placeholder = chatting ? t("Haz otra pregunta…") : t("Pregunta lo que quieras sobre el DOGV…");
  }
  function setSession(open) {
    sessionOpen = open;
    store("chatOpen", open);
    paintChat();
  }
  // «Retomarla»: vuelve a la conversación guardada con sus documentos (lo adjuntado en el inicio se descarta)
  function openSession() {
    if (sessionOpen) return;
    dropAttachments(attachments);
    attachments = parked;
    parked = [];
    setSession(true);
    saveAttachments();
    paintAttachments();
    thread.lastElementChild?.scrollIntoView({ block: "start" });
    ta.focus();
  }
  // «Inicio»: vuelve a la pantalla inicial, que es el principio de una conversación nueva; la actual queda guardada
  // (con sus documentos aparcados) para retomarla
  function closeSession() {
    if (!sessionOpen) return;
    parked = attachments.filter((a) => !a.busy);
    attachments = [];
    setSession(false);
    saveAttachments();
    paintAttachments();
    scrollTo({ top: 0 });
    ta.focus();
  }
  // una pregunta escrita en el inicio empieza una conversación nueva: la guardada se descarta con sus documentos
  function startNewConversation() {
    dropAttachments(parked);
    parked = [];
    chat = [];
    store("chat", chat);
    thread.replaceChildren();
    setSession(true);
    saveAttachments();
  }
  function addTurn(question) {
    const body = h("div");
    const turn = h("div", { class: "chat-turn" },
      h("div", { class: "chat-q" }, h("span", { class: "sr-only" }, t("Tu pregunta:"), " "), question), body);
    thread.append(turn);
    paintChat();
    return { turn, body };
  }
  function renderStoredTurn(turn) {
    const { body } = addTurn(turn.question);
    const run = new RunPanel(body, turn.pipeline, st, turn.question, { simple: true, scroll: false, onExpand: () => expandStored(turn) });
    run.graph.quiet = true;
    run.onEvent(turn.result);
  }
  // los turnos guardados no tienen los eventos: se piden al servidor, que conserva las ejecuciones recientes
  async function expandStored(turn) {
    try {
      const rec = await getJSON(`/api/runs/${encodeURIComponent(turn.run_id)}`);
      expand({ pipeline: rec.pipeline, question: rec.question, events: rec.events, result: rec.events.find((e) => e.type === "result") });
    } catch { toast(t("Esta ejecución ya no está en el servidor (se ha reiniciado).")); }
  }
  function newChat() {
    controller?.abort();
    chat = [];
    store("chat", chat);
    thread.replaceChildren();
    dropAttachments([...attachments, ...parked]);   // los adjuntos son de la conversación
    attachments = [];
    parked = [];
    paintAttachments();
    setSession(true);   // la siguiente pregunta abre una sesión nueva
    saveAttachments();
    scrollTo({ top: 0 });
    ta.focus();
  }
  async function askChat(q) {
    if (attachments.some((a) => a.busy)) {
      toast(t("Espera a que termine de procesarse el documento."));
      go.disabled = !ta.value.trim();
      return;
    }
    const pipe = stdModel;
    if (!sessionOpen) startNewConversation();   // desde el inicio: conversación nueva (la guardada se descarta)
    // historial: la pregunta tal como la entendió el servidor y el principio de la respuesta
    const history = chat.slice(-CHAT_HISTORY).map((x) => ({ question: x.result.question || x.question, answer: short(x.result.answer || "", 1200) }));
    ta.value = "";
    autosize();
    const { turn, body } = addTurn(q);
    turn.scrollIntoView({ behavior: "smooth", block: "start" });
    const run = new RunPanel(body, pipe, st, q, { simple: true, scroll: false, onExpand: () => expand(run.snapshot()) });
    searchBox.classList.add("busy");
    try {
      await streamRun({ question: q, pipeline: pipe, history, generate: st.llm.available, attachments: attachments.map((a) => a.id) },
        (ev) => run.onEvent(ev), controller.signal);
      const snap = run.snapshot();
      state.lastRun = snap;
      if (snap.result) {
        const runId = snap.events.find((e) => e.type === "start")?.run_id;
        chat = [...chat, { question: q, pipeline: pipe, run_id: runId, result: { ...snap.result, messages: null } }].slice(-CHAT_TURNS);
        store("chat", chat);
      }
    } catch (e) {
      if (e.name !== "AbortError") { toast(e.message); run.onEvent({ type: "error", message: e.message }); }
    } finally { go.disabled = !ta.value.trim(); searchBox.classList.remove("busy"); }
  }

  // ---------- ejecución
  async function submit(q = ta.value.trim()) {
    if (!q) return;
    // en el chat no se interrumpe la respuesta en curso: la siguiente pregunta espera
    if (mode === "standard" && searchBox.classList.contains("busy")) return;
    controller?.abort();
    controller = new AbortController();
    store("history", [q, ...(store("history") || []).filter((x) => x !== q)].slice(0, 8));
    go.disabled = true;
    // en modo simple se pregunta con el modelo elegido y la configuración por defecto, dentro de la conversación
    if (mode === "standard") return askChat(q);
    const run = new RunPanel(results, pipeline, st, q);
    searchBox.classList.add("busy");
    try {
      await streamRun({ question: q, pipeline, filters, options, generate: generate && st.llm.available },
        (ev) => run.onEvent(ev), controller.signal);
      state.lastRun = run.snapshot();
    } catch (e) {
      if (e.name !== "AbortError") { toast(e.message); run.onEvent({ type: "error", message: e.message }); }
    } finally { go.disabled = !ta.value.trim(); searchBox.classList.remove("busy"); }
  }
  // reproduce una ejecución ya terminada: al cambiar de idioma, o al abrir #/ask?run=<id> (enlace desde Open WebUI)
  const replayRun = (lr, scroll = false) => {
    ta.value = lr.question;
    autosize();
    const run = new RunPanel(results, lr.pipeline, st, lr.question, { scroll });
    run.graph.quiet = true;
    lr.events.forEach((ev) => run.onEvent(ev));
    run.graph.quiet = false;
  };
  // «Ver cómo se ha encontrado»: pasa a modo experto con la misma ejecución y su arquitectura seleccionada
  function expand(lr) {
    state.lastRun = lr;
    pipeline = lr.pipeline;
    store("pipeline", pipeline);
    pipeSeg.set(pipeline);
    options = {};
    paintSettings();
    paintPipeHint();
    setMode("advanced");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const runId = new URLSearchParams(location.hash.split("?")[1] || "").get("run");
  if (runId) {
    getJSON(`/api/runs/${encodeURIComponent(runId)}`).then((rec) => {
      state.lastRun = { pipeline: rec.pipeline, question: rec.question, events: rec.events, result: rec.events.find((e) => e.type === "result") };
      if (mode === "standard") setMode("advanced");   // el enlace abre el proceso completo
      replayRun(state.lastRun, true);
    }).catch((e) => toast(e.message));
  } else if (restore && state.lastRun?.result) {
    replayRun(state.lastRun);
  }
  if (state.pendingQuestion) { ta.value = state.pendingQuestion; state.pendingQuestion = null; autosize(); submit(); }
  return { destroy: () => { controller?.abort(); constellation?.destroy(); document.body.classList.remove("chat-session"); } };
}

// ------------------------------------------------------------------ panel de una ejecución
class RunPanel {
  constructor(container, pipeline, st, question, { scroll = true, simple = false, onExpand = null } = {}) {
    this.p = pipeline;
    this.simple = simple;
    this.st = st;
    this.q = question;
    this.color = PIPES[pipeline].color;
    this.cfg = { ...st.pipelines[pipeline] };
    this.events = [];
    this.chunks = {};
    this.ctx = { embeds: 0, device: st.models.device };

    // grafo + narración
    this.graphBox = h("div", { class: "pipe-wrap" });
    this.stepEl = h("div", { class: "step" }, "—");
    this.txtEl = h("div", { class: "txt" }, t("Preparando…"));
    this.replayBtn = h("button", { class: "btn secondary sm", disabled: true, onclick: () => this.replay() }, icon("play"), t("Paso a paso"));
    this.prevBtn = h("button", { class: "icon-btn", "aria-label": t("Paso anterior"), disabled: true, onclick: () => this.stepTo(this.cursor - 1) }, icon("prev"));
    this.nextBtn = h("button", { class: "icon-btn", "aria-label": t("Paso siguiente"), disabled: true, onclick: () => this.stepTo(this.cursor + 1) }, icon("next"));
    const pipeCard = h("div", { class: "card", style: { "--pc": this.color } },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "eyebrow", style: { color: this.color } }, t(PIPES[pipeline].label)), h("h3", {}, short(question, 140))),
        h("div", { class: "kpis" }, this.kpiEl = h("span", {}, h("span", { class: "spinner" })))),
      this.graphBox,
      h("div", { class: "narrative" }, this.stepEl, this.txtEl, h("div", { class: "ctl" }, this.prevBtn, this.nextBtn, this.replayBtn)));
    this.graph = new PipelineGraph(this.graphBox, pipeline, this.color);

    // respuesta y fuentes
    this.answerBody = h("div", { class: "answer", translate: "no" }, h("div", { class: "skeleton", "aria-label": t("Buscando…") }, h("span"), h("span"), h("span"), h("span", { class: "short" })));
    this.answerExtra = h("div");
    this.sourcesEl = h("div", { class: "sources" }, [0, 1, 2].map(() => h("div", { class: "skeleton card-skel" }, h("span", { class: "short" }), h("span"), h("span"))));
    const answerCard = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, t("Respuesta")), this.groundBtn = h("span")), this.answerBody, this.answerExtra);
    const sourcesCard = h("div", { class: "card" }, h("div", { class: "card-head" },
      h("div", {}, h("h3", {}, t("Fuentes")), h("div", { class: "sub" }, t("En el orden en que entran al prompt")))), this.sourcesEl);

    // análisis
    this.tabs = {};
    this.tabBar = h("div", { class: "subtabs", role: "tablist" });
    this.tabBody = h("div");
    const analysis = h("div", { class: "card" }, h("div", { class: "card-head" },
      h("div", {}, h("h3", {}, t("Dentro del retrieval")), h("div", { class: "sub" }, t("Pasa el ratón por cualquier elemento para ver el chunk")))), this.tabBar, this.tabBody);
    this.flowBox = h("div", { style: { overflowX: "auto" } });
    this.flow = new RankFlow(this.flowBox, pipeline, this.color);
    this.addTab("flow", t("Recorrido de candidatos"), () => h("div", {},
      h("p", { class: "small muted", style: { marginTop: 0 } }, t("Top 12 de cada etapa. Las líneas unen el mismo chunk; en color, los que acaban en el contexto. Una línea discontinua desde abajo indica que venía de fuera del top 12.")),
      this.flowBox));

    if (simple) {
      // modo simple (la respuesta de un turno del chat): el texto con sus citas, que abren cada fuente al pasar el
      // ratón, y una línea discreta debajo; el proceso completo se ve al pasar a modo experto
      this.statusEl = h("div", { class: "simple-status", role: "status" }, h("span", { class: "typing", "aria-hidden": "true" }, h("i"), h("i"), h("i")), t("Buscando en el DOGV…"));
      this.noteEl = h("div", { class: "simple-note hidden" });
      this.answerBody.replaceChildren();
      this.metaEl = h("div", { class: "chat-meta hidden" });
      this.onExpand = onExpand;
      const msg = h("div", { class: "chat-a" }, h("div", { class: "chat-mark", "aria-hidden": "true" }, "§"),
        h("div", { class: "chat-a-body" }, h("h3", { class: "sr-only" }, t("Respuesta")), this.statusEl, this.noteEl, this.answerBody, this.metaEl));
      container.replaceChildren(msg);
      if (scroll) msg.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      container.replaceChildren(
        h("div", { class: "section-title" }, h("h2", {}, t("Ejecución")), h("span", { class: "small muted" }, t("Eventos reales del servidor, en directo"))),
        pipeCard,
        h("div", { class: "split", style: { marginTop: "16px" } }, answerCard, sourcesCard),
        h("div", { style: { marginTop: "16px" } }, analysis),
      );
      if (scroll) pipeCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    this.select("flow");
  }

  addTab(key, label, render) {
    if (this.tabs[key]) { this.tabs[key].render = render; if (this.active === key) this.select(key); return; }
    const btn = h("button", { role: "tab", onclick: () => this.select(key) }, label);
    this.tabs[key] = { btn, render };
    this.tabBar.append(btn);
  }

  select(key) {
    this.active = key;
    Object.entries(this.tabs).forEach(([k, tab]) => tab.btn.setAttribute("aria-selected", k === key));
    this.tabBody.replaceChildren(this.tabs[key].render());
  }

  onEvent(ev) {
    this.events.push(ev);
    Object.assign(this.chunks, ev.chunks || {});
    this.flow.addChunks(ev.chunks);
    if (ev.type === "start") { Object.assign(this.cfg, ev.config); this.graphBox.classList.add("running"); }
    if (ev.type === "result" || ev.type === "error") this.graphBox.classList.remove("running");
    if (ev.type === "embed") this.ctx.embeds += 1;
    this.ctx.config = this.cfg;
    this.graph.apply(ev, this.cfg);
    const d = describe(ev, this.ctx);
    if (d) { this.stepEl.textContent = d.step; this.txtEl.innerHTML = d.html; }
    this.updateViews(ev);
  }

  updateViews(ev) {
    const first = ev.pass === 1 || ev.pass === undefined;
    switch (ev.type) {
      case "dense": if (first && !this.flow.cols.dense) this.flow.setStage("dense", ev.hits, t("coseno · {ms}", { ms: fmtMs(ev.ms) })); this.dense ||= ev; break;
      case "bm25": if (first && !this.flow.cols.bm25) this.flow.setStage("bm25", ev.hits, t("{n} con términos", { n: fmtNum(ev.n) })); this.bm25 ||= ev; this.queryTab(); break;
      case "fusion": if (first && !this.flow.cols.rrf) { this.flow.setStage("rrf", ev.hits, `k = ${ev.rrf_k}`); this.fusion = ev; this.scatterTab(); } break;
      case "rerank":
        if (first && !this.flow.cols.rerank) { this.flow.setStage("rerank", ev.hits, `cross-encoder · ${fmtMs(ev.ms)}`); this.rerank = ev; }
        else this.rerank2 = ev;
        this.gateTab();
        break;
      case "llm":
        if (ev.purpose === "rewrite") this.rewrites = ev.output;
        if (ev.purpose === "hyde") this.hyde = ev.output;
        this.gateTab();
        break;
      case "embed": if (!this.embed) { this.embed = ev; this.queryTab(); } break;
      case "agent_plan": case "agent_obs": case "agent_done": {
        const first = !this.tabs.agent;
        this.agentTab();
        if (first || this.active === "agent") this.select("agent");
        break;
      }
      case "result": this.onResult(ev); break;
      case "error":
        this.statusEl?.remove();
        this.answerBody.replaceChildren(h("div", { class: "abstain" }, icon("alert"), h("div", {}, h("b", {}, "Error"), h("div", { class: "small" }, ev.message))));
        this.kpiEl.textContent = t("error");
        break;
    }
  }

  onResult(ev) {
    this.result = ev;
    this.statusEl?.remove();
    // pregunta de seguimiento reescrita por el servidor con la conversación
    if (this.noteEl && ev.question && ev.question !== this.q) {
      this.noteEl.replaceChildren(icon("pen"), h("span", {}, t("Pregunta interpretada:"), " ", h("i", {}, `«${ev.question}»`)));
      this.noteEl.classList.remove("hidden");
    }
    this.ctx.nContexts = ev.contexts.length;
    const byRank = [...ev.contexts].sort((a, b) => a.rank - b.rank);
    this.flow.setStage("ctx", byRank.map((c) => ({ id: c.chunk_ids[0], s: c.score, n: c.n })), t("top-{n} · [n] en el prompt", { n: ev.contexts.length }));
    this.kpiEl.replaceChildren(h("span", {}, t("Total") + " ", h("b", {}, fmtMs(ev.total_ms))));

    // respuesta
    const abstain = ev.trace?.abstain;
    if (abstain) {
      this.answerBody.replaceChildren(h("div", { class: "abstain" }, icon("shield"), h("div", {}, h("b", {}, t("El sistema se abstiene")),
        h("div", { class: "small" }, ev.answer))));
    } else if (!ev.generated) {
      this.answerBody.replaceChildren(h("div", { class: "empty" }, icon("info"), h("div", {}, t("Modo solo retrieval: no se ha generado respuesta.")),
        h("div", { class: "small" }, t("Conecta un LLM desde la barra superior o activa «Generar respuesta». Debajo tienes los fragmentos que recibiría."))));
    } else {
      this.answerBody.innerHTML = renderAnswer(ev.answer);
      stagger(this.answerBody);
      if (this.simple) citePopovers(this.answerBody, ev.contexts, this.cfg.contextual ? "advanced" : "naive", ev.attachments || []);
      else linkCitations(this.answerBody, this.sourcesEl);
      const btn = h("button", { class: "btn ghost sm", onclick: () => this.grounding(btn) }, icon("check"), t("Comprobar fundamentación"));
      this.groundBtn.replaceChildren(btn);
    }
    const chars = ev.contexts.reduce((a, c) => a + c.text.length, 0);
    const verdict = ev.trace?.verdict;
    this.answerExtra.replaceChildren(
      timingBar(ev.timings),
      h("div", { class: "kpis", style: { marginTop: "10px" } },
        h("span", {}, t("Contexto") + " ", h("b", {}, t("{n} car.", { n: fmtNum(chars) })), h("span", { class: "muted" }, ` ≈ ${fmtNum(Math.round(chars / 4))} tokens`)),
        verdict ? h("span", {}, t("Veredicto") + " ", h("b", {}, t(VERDICTS[verdict] || verdict))) : null,
        ev.trace?.n_candidates != null && !ev.trace.steps ? h("span", {}, t("Candidatos") + " ", h("b", {}, ev.trace.n_candidates)) : null,
        ev.trace?.steps ? h("span", {}, t("Pasos") + " ", h("b", {}, ev.trace.steps.length), h("span", { class: "muted" }, " · " + t("{n} búsquedas", { n: ev.trace.queries.length }))) : null,
        ev.trace?.steps ? h("span", {}, t("Evidencias") + " ", h("b", {}, `${(ev.trace.selected || []).length}/${ev.trace.n_evidence ?? 0}`)) : null),
      ev.messages ? h("details", { class: "disclose" }, h("summary", {}, t("Ver el prompt exacto")),
        h("pre", { class: "code", translate: "no", html: ev.messages.map((m) => `<span class="role">${m.role.toUpperCase()}</span>\n${esc(m.content)}`).join("\n\n") })) : null,
    );

    // chat: número de fuentes, modelo y enlace al proceso, en una sola línea bajo la respuesta
    if (this.simple) {
      const model = this.p === "naive" ? t("Estándar") : t("Avanzado");
      this.metaEl.replaceChildren(
        h("span", {}, ev.contexts.length === 1 ? t("1 fuente") : t("{n} fuentes", { n: ev.contexts.length })),
        ev.attachments?.length ? h("span", {}, t("+ documento adjunto")) : null,
        h("span", {}, model),
        this.onExpand ? h("button", { class: "linkish", onclick: this.onExpand }, t("Ver cómo se ha encontrado")) : null);
      this.metaEl.classList.remove("hidden");
    }

    // fuentes
    const chunker = this.cfg.contextual ? "advanced" : "naive";
    this.sourcesEl.replaceChildren(...(ev.contexts.length ? ev.contexts.map((c) => sourceCard(c, this.color, { chunker, compact: this.simple }))
      : [h("div", { class: "empty small" }, t("Ningún fragmento supera los filtros."))]));
    stagger(this.sourcesEl, 60);

    this.ctxTab();
    this.mapTab();
    this.replayBtn.disabled = false;
    this.cursor = this.events.length - 1;
    this.prevBtn.disabled = false;
  }

  // ---------- pestañas de análisis
  queryTab() {
    if (!this.embed) return;
    this.addTab("query", t("La consulta"), () => {
      const e = this.embed;
      const max = Math.max(...e.preview.map(Math.abs));
      const out = h("div", { class: "grid g2" },
        h("div", {}, h("div", { class: "label" }, t("Vector denso")),
          h("p", { class: "small muted" }, t("{dim} dimensiones (se muestran {n}). Azul: negativo, naranja: positivo. Los vectores están normalizados (norma {norm}), así que el producto escalar es el coseno.", { dim: e.dim, n: e.preview.length, norm: e.norm })),
          h("div", { class: "vec" }, e.preview.map((v, i) => bindTip(h("span", { style: { background: diverging(v, max) } }), `dim ${i}: ${v}`)))),
        h("div", {}, h("div", { class: "label" }, t("Términos BM25")),
          this.bm25 ? [
            h("p", { class: "small muted" }, t("Tras plegar acentos, quitar stopwords y aplicar stemming Snowball. Así se compara con el índice léxico.")),
            h("div", { class: "tokens" }, this.bm25.tokens.map((w) => h("span", { class: "tok" }, w))),
            h("div", { class: "label", style: { marginTop: "16px" } }, t("Términos presentes en los mejores chunks BM25")),
            h("div", { class: "table-wrap", style: { marginTop: "8px" } }, h("table", { class: "t" },
              h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Chunk"), h("th", {}, t("Términos (frecuencia)")), h("th", { class: "num" }, "BM25"))),
              h("tbody", {}, this.bm25.hits.slice(0, 8).map((x, i) => bindTip(h("tr", {},
                h("td", {}, i + 1), h("td", { class: "mono" }, this.chunks[x.id]?.code),
                h("td", {}, h("div", { class: "tokens" }, this.bm25.tokens.map((w) => h("span", { class: `tok ${x.terms?.[w] ? "hit" : "drop"}` }, x.terms?.[w] ? `${w}×${x.terms[w]}` : w)))),
                h("td", { class: "num" }, fmtScore(x.s, 2))), () => chunkTip(this.chunks[x.id]))))))]
            : h("p", { class: "small muted" }, t("La arquitectura naive no usa BM25: solo la rama densa."))));
      return out;
    });
  }

  scatterTab() {
    this.addTab("scatter", t("Denso vs BM25"), () => {
      const ctxIds = new Set((this.result?.contexts || []).map((c) => c.chunk_ids[0]));
      const pts = this.fusion.hits.map((x) => ({
        x: x.sc.dense ?? 0, y: x.sc.bm25 ?? 0, r: 4 + (x.sc.rrf ?? 0) * 220, ring: ctxIds.has(x.id),
        color: x.sc.dense != null && x.sc.bm25 != null ? this.color : x.sc.dense != null ? "var(--c-naive)" : "var(--c-hybrid)",
        tip: chunkTip(this.chunks[x.id], `${t("Denso")} <b>${fmtScore(x.sc.dense)}</b> · BM25 <b>${fmtScore(x.sc.bm25, 2)}</b> · RRF <b>${fmtScore(x.sc.rrf, 4)}</b>`),
      }));
      const minD = Math.min(...pts.filter((p) => p.x > 0).map((p) => p.x));
      return h("div", { class: "grid g2" },
        h("div", {}, scatter(pts, { xLabel: t("similitud densa (coseno)"), yLabel: t("score BM25"), xMax: 1 })),
        h("div", { class: "small ink2" },
          h("p", { style: { marginTop: 0 } }, t("Cada punto es un candidato de la fusión. El tamaño es su score RRF; con borde, los que acaban en el contexto.")),
          legend([[t("en ambas listas"), this.color], [t("solo denso"), "var(--c-naive)"], [t("solo BM25"), "var(--c-hybrid)"]]),
          h("p", {}, t("Los puntos sobre el eje horizontal solo los encuentra la rama densa (paráfrasis, sinónimos); los del eje vertical, solo BM25 (códigos, nombres, cifras exactas). RRF premia a los que están arriba en las dos.")),
          h("p", { class: "muted" }, t("Los scores densos de este modelo se concentran en un rango estrecho (aquí desde {min}): por eso RRF fusiona por posición y no por valor.", { min: fmtScore(minD, 2) }))));
    });
  }

  gateTab() {
    if (!this.rerank) return;
    const corrective = this.p === "corrective";
    this.addTab("gate", corrective ? t("Evaluador (CRAG)") : t("Scores del reranker"), () => {
      const cfg = this.cfg, tr = this.result?.trace || {};
      const best1 = this.rerank.hits[0]?.s ?? 0;
      const best2 = tr.second_pass_best;
      const zoneOf = (v) => (v >= cfg.tau_ok ? "var(--good)" : v >= cfg.tau_abstain ? "var(--warn)" : "var(--bad)");
      const bars = barsH(this.rerank.hits.slice(0, 12).map((x) => ({
        label: `${this.chunks[x.id]?.code || x.id}${this.chunks[x.id]?.idx ? " · " + (this.chunks[x.id].idx + 1) : ""}`, value: x.s,
        color: corrective ? zoneOf(x.s) : this.color, tip: chunkTip(this.chunks[x.id], t("Reranker {s} · antes #{prev}", { s: `<b>${fmtScore(x.s)}</b>`, prev: x.prev })) })),
        { max: 1, fmt: (v) => v.toFixed(3), labelW: 130, width: 520 });
      const out = h("div", { class: "grid g2" });
      const left = h("div", {});
      if (corrective) {
        const gate = h("div", { class: "gate" },
          h("div", { class: "z", style: { width: `${cfg.tau_abstain * 100}%`, background: "var(--bad-soft)" } }, h("span", {}, t("abstención"))),
          h("div", { class: "z", style: { width: `${(cfg.tau_ok - cfg.tau_abstain) * 100}%`, background: "var(--warn-soft)" } }, h("span", {}, t("ambiguo → reformula"))),
          h("div", { class: "z", style: { width: `${(1 - cfg.tau_ok) * 100}%`, background: "var(--good-soft)" } }, h("span", {}, t("correcto"))),
          h("div", { class: "tick", style: { left: `${cfg.tau_abstain * 100}%` } }, h("em", {}, `τ_abstain ${cfg.tau_abstain}`)),
          h("div", { class: "tick", style: { left: `${cfg.tau_ok * 100}%` } }, h("em", {}, `τ_ok ${cfg.tau_ok}`)));
        const m1 = h("div", { class: "marker", style: { left: "0%" } }, h("b", {}, `1ª ${fmtScore(best1, 2)}`));
        gate.append(m1);
        requestAnimationFrame(() => requestAnimationFrame(() => { m1.style.left = `${best1 * 100}%`; }));
        if (best2 != null && tr.verdict !== "correct") {
          const m2 = h("div", { class: "marker second", style: { left: `${best1 * 100}%` } }, h("b", { style: { bottom: "-30px" } }, `2ª ${fmtScore(best2, 2)}`));
          gate.append(m2);
          setTimeout(() => { m2.style.left = `${best2 * 100}%`; }, 700);
        }
        const verdict = { correct: ["good", "Correcto: se usa el contexto tal cual"], ambiguous: ["warn", "Ambiguo: se reformula y se busca otra vez"], incorrect: ["bad", "Incorrecto: se abstiene"] }[tr.verdict] || ["neutral", tr.verdict || "evaluando…"];
        left.append(h("div", { class: "label" }, t("Puerta de relevancia")),
          h("p", { class: "small muted" }, t("Corrective RAG usa el mejor score del reranker como evaluador. Los umbrales dependen del reranker y hay que calibrarlos con preguntas reales.")),
          gate, h("span", { class: `badge ${verdict[0]}` }, t(verdict[1])),
          tr.note ? h("p", { class: "small muted" }, t(tr.note)) : null,
          this.rewrites ? h("div", { style: { marginTop: "14px" } }, h("div", { class: "label" }, t("Reformulaciones (multi-query)")),
            h("ul", { class: "small", translate: "no", style: { margin: "6px 0", paddingLeft: "1.2em" } }, this.rewrites.split("\n").map((x) => x.trim()).filter((x) => x.length > 8).map((x) => h("li", {}, x)))) : null,
          this.hyde ? h("div", { style: { marginTop: "10px" } }, h("div", { class: "label" }, t("Documento hipotético (HyDE)")), h("p", { class: "small ink2", translate: "no" }, this.hyde)) : null);
      } else {
        left.append(h("div", { class: "label" }, t("Qué hace el reranker")),
          h("p", { class: "small ink2" }, t("El bi-encoder compara vectores calculados por separado; el cross-encoder lee la pregunta y el chunk juntos y estima directamente su relevancia. Es mucho más lento, por eso solo se aplica a los candidatos de la fusión.")),
          h("p", { class: "small muted" }, t("Modelo: {model} · {n} candidatos en {ms}.", { model: cfg.reranker || "—", n: this.rerank.hits.length, ms: fmtMs(this.rerank.ms) })));
      }
      out.append(left, h("div", {}, h("div", { class: "label", style: { marginBottom: "8px" } }, t("Score del reranker por candidato")), bars));
      return out;
    });
  }

  // trayectoria del agente: una tarjeta por paso (razonamiento, acción, lo que vuelve) y la selección final
  agentTab() {
    this.addTab("agent", t("Trayectoria del agente"), () => {
      const evs = this.events.filter((e) => e.type.startsWith("agent_"));
      const obs = Object.fromEntries(evs.filter((e) => e.type === "agent_obs").map((e) => [e.step, e]));
      const done = evs.find((e) => e.type === "agent_done");
      const chosen = new Set((done?.evidence || []).map((x) => x.ref));
      const ACT = { search: ["search", "Buscar"], read: ["doc", "Leer"], finish: ["check", "Terminar"] };
      const steps = evs.filter((e) => e.type === "agent_plan").map((p) => {
        const o = obs[p.step];
        const [ic, label] = ACT[p.action] || ["info", p.action];
        const body = [];
        if (p.thought) body.push(h("p", { class: "agent-thought", translate: "no" }, p.thought));
        if (p.action === "search") body.push(h("div", { class: "agent-query" }, h("span", { class: "mono", translate: "no" }, `«${p.query}»`),
          Object.entries(p.filters || {}).map(([k, v]) => h("span", { class: "tok" }, `${k}=${v}`))));
        if (p.action === "read") body.push(h("div", { class: "agent-query" }, h("span", { class: "mono" }, p.ref),
          o ? h("span", { class: "muted small" }, o.ok ? t("{n} car. leídos", { n: fmtNum(o.chars) }) : t("ref no válida")) : null));
        if (p.action === "finish") body.push(h("div", { class: "agent-query" }, (p.evidence || []).length
          ? p.evidence.map((r) => h("span", { class: "tok hit" }, r))
          : h("span", { class: "muted small" }, p.evidence ? t("sin evidencias: abstención") : t("sin lista: se usan las de mejor score"))));
        if (o?.action === "search") {
          body.push(o.duplicate ? h("p", { class: "small muted" }, t("Búsqueda repetida: no se ejecuta."))
            : o.results.length ? h("div", { class: "agent-results" }, o.results.map((x) => {
              const c = this.chunks[x.id] || {};
              return bindTip(h("div", { class: `agent-res${chosen.has(x.ref) ? " chosen" : ""}${x.new ? "" : " seen"}` },
                h("b", { class: "mono" }, x.ref),
                h("span", { class: "mono small" }, c.code || x.id),
                h("span", { class: "small ink2 agent-title", translate: "no" }, short(c.title || "", 90)),
                h("span", { class: "bar" }, h("span", { style: { width: `${Math.max(2, Math.min(100, x.s * 100))}%` } })),
                h("span", { class: "mono small" }, fmtScore(x.s, 3))), () => chunkTip(c, x.new ? "" : t("ya vista en un paso anterior")));
            })) : h("p", { class: "small muted" }, t("Ningún resultado.")));
        } else if (p.action === "search") {
          body.push(h("div", { class: "skeleton", style: { marginTop: "8px" } }, h("span"), h("span", { class: "short" })));
        }
        return h("li", { class: `agent-step${p.fallback ? " forced" : ""}` },
          h("div", { class: "agent-dot" }, icon(ic)),
          h("div", { class: "agent-body" },
            h("div", { class: "agent-head" }, h("b", {}, t("Paso {n}", { n: p.step })), h("span", { class: "badge neutral" }, t(label)),
              p.fallback ? h("span", { class: "tiny muted" }, t("acción por defecto")) : null),
            body));
      });
      const thinking = this.result || done ? null
        : h("li", { class: "agent-step pending" }, h("div", { class: "agent-dot" }, h("span", { class: "spinner" })),
          h("div", { class: "agent-body small muted" }, t("El agente está decidiendo…")));
      return h("div", { class: "grid g2 agent-grid" },
        h("ol", { class: "agent-steps", style: { "--pc": this.color } }, steps, thinking),
        h("div", { class: "small ink2" },
          h("div", { class: "label" }, t("Cómo funciona")),
          h("p", { style: { marginTop: "6px" } }, t("En cada paso el LLM recibe la pregunta y todo lo que ha visto hasta ahora, y responde con una acción en JSON: buscar (con la consulta y los filtros que elija), leer entera una evidencia o terminar eligiendo las evidencias.")),
          h("p", {}, t("Cada búsqueda es la del Advanced (BM25 + denso, RRF y reranker). Las evidencias reciben referencias E1, E2… que el agente usa para elegirlas; al terminar, las elegidas entran al contexto y la respuesta se redacta con el mismo prompt que el resto de arquitecturas.")),
          done ? h("div", { class: "kpis", style: { marginTop: "10px" } },
            h("span", {}, t("Reunidas") + " ", h("b", {}, done.n_pool)),
            h("span", {}, t("Elegidas") + " ", h("b", {}, done.evidence.length)),
            h("span", {}, t("Parada") + " ", h("b", {}, t({ finish: "decisión del agente", max_steps: "límite de pasos" }[done.stop] || done.stop)))) : null,
          h("p", { class: "muted" }, t("Más caro que Corrective (una llamada al LLM por paso), pero adapta la estrategia a cada pregunta: descompone preguntas compuestas, prueba sinónimos y filtra por organismo o fecha."))));
    });
  }

  ctxTab() {
    const ev = this.result;
    if (!ev.contexts.length) return;
    this.addTab("ctx", t("Orden del contexto"), () => {
      const k = ev.contexts.length;
      const boxes = ev.contexts.map((c) => {
        const hgt = 30 + (1 - (c.rank - 1) / Math.max(1, k - 1)) * 70;
        return bindTip(h("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" } },
          h("div", { style: { width: "100%", maxWidth: "70px", height: `${hgt}px`, background: this.color, opacity: 0.25 + 0.75 * (1 - (c.rank - 1) / Math.max(1, k)), borderRadius: "6px 6px 2px 2px", transition: "height .6s" } }),
          h("div", { class: "mono small" }, `[${c.n}]`), h("div", { class: "tiny muted" }, `rank #${c.rank}`)), chunkTip(this.chunks[c.chunk_ids[0]]));
      });
      const reordered = ev.contexts.some((c) => c.n !== c.rank);
      return h("div", { class: "grid g2" },
        h("div", {}, h("div", { style: { display: "flex", alignItems: "flex-end", gap: "10px", height: "140px" } }, boxes),
          h("div", { class: "tiny muted", style: { display: "flex", justifyContent: "space-between", marginTop: "8px" } }, h("span", {}, t("inicio del prompt")), h("span", {}, t("final del prompt")))),
        h("div", { class: "small ink2" },
          h("p", { style: { marginTop: 0 } }, reordered
            ? t("Los fragmentos se reordenan para que los más relevantes queden al principio y al final del prompt, y los peores en el centro: los LLM atienden peor a lo que está en medio de un contexto largo (lost in the middle).")
            : t("Esta arquitectura pasa los fragmentos en orden de score, sin reordenar.")),
          h("p", { class: "muted" }, t("La altura de cada barra es la relevancia (rank #1 = la más alta)."))));
    });
  }

  mapTab() {
    const ev = this.result;
    if (!ev.query_xy) return;
    this.addTab("map", t("Mapa semántico"), () => {
      const canvas = h("canvas", { style: { height: "440px" } });
      const box = h("div", { class: "map-wrap" }, canvas);
      const map = new SemanticMap(canvas);
      const info = h("p", { class: "small muted", style: { marginTop: 0 } }, t("Cargando proyección…"));
      cached(`/api/map/${ev.index}`).then((d) => {
        map.setData(d);
        map.setQuery({ xy: ev.query_xy, ids: ev.contexts.flatMap((c) => c.chunk_ids), color: PIPES[this.p].hex });
        info.textContent = t("Proyección PCA de {n} chunks del índice «{index}»; los dos ejes conservan el {pct}% de la varianza, así que las distancias son orientativas. Rueda para hacer zoom, arrastra para moverte, doble clic para centrar.", {
          n: fmtNum(d.n), index: ev.index, pct: Math.round(d.explained * 100) });
      });
      return h("div", {}, info, box);
    });
  }

  // ---------- fundamentación de la respuesta
  async grounding(btn) {
    btn.disabled = true;
    btn.replaceChildren(h("span", { class: "spinner" }), t("Analizando…"));
    try {
      const ev = this.result;
      const g = await postJSON("/api/grounding", { answer: ev.answer, contexts: ev.contexts.map((c) => c.text) });
      const cls = (v) => (v >= 0.88 ? "g-hi" : v >= 0.82 ? "g-mid" : "g-lo");
      const wrap = h("div", { class: "answer", translate: "no" });
      for (const sn of g.sentences) {
        const ok = !sn.cites.length || sn.cites.includes(sn.best.ctx) || (sn.best_cited && sn.best_cited.sim >= sn.best.sim - 0.02);
        const span = h("span", { class: `sent ${cls(sn.best.sim)}`, html: renderAnswer(sn.text).replace(/^<p>|<\/p>$/g, "") + " " });
        bindTip(span, t("Apoyo más cercano: fragmento {n} · similitud {sim}", { n: `<b>[${sn.best.ctx}]</b>`, sim: `<b>${fmtScore(sn.best.sim)}</b>` }) +
          (sn.cites.length
            ? `<br>${t("Cita")} ${sn.cites.map((c) => `[${c}]`).join(" ")}: ${ok ? `<b style='color:var(--good)'>${t("coherente")}</b>` : `<b style='color:var(--bad)'>${t("el mejor apoyo está en otro fragmento")}</b>`}`
            : `<br><span class='t-muted'>${t("Frase sin cita")}</span>`) +
          `<div class="t-muted" style="margin-top:6px">«${esc(short(sn.best.text, 240))}»</div>`);
        wrap.append(span);
      }
      this.answerBody.replaceChildren(wrap,
        h("div", { class: "legend", style: { marginTop: "10px" } },
          h("span", {}, h("i", { style: { background: "var(--good-soft)" } }), t("apoyo fuerte")),
          h("span", {}, h("i", { style: { background: "var(--warn-soft)" } }), t("apoyo parcial")),
          h("span", {}, h("i", { style: { background: "var(--bad-soft)" } }), t("sin apoyo cercano")),
          h("span", { class: "muted" }, t("· similitud media {sim} · señal aproximada con embeddings", { sim: fmtScore(g.mean) }))));
      linkCitations(this.answerBody, this.sourcesEl);
      btn.replaceChildren(icon("check"), t("Fundamentación"));
    } catch (e) { toast(e.message); btn.disabled = false; btn.replaceChildren(icon("check"), t("Comprobar fundamentación")); }
  }

  // ---------- reproducción paso a paso
  stepTo(i) {
    i = Math.max(0, Math.min(this.events.length - 1, i));
    this.cursor = i;
    this.graph.quiet = true;
    this.graph.reset();
    const ctx = { embeds: 0, config: this.cfg, nContexts: this.result?.contexts.length, device: this.st.models.device };
    for (let j = 0; j <= i; j++) {
      const ev = this.events[j];
      if (ev.type === "embed") ctx.embeds += 1;
      if (j === i) this.graph.quiet = false;
      this.graph.apply(ev, this.cfg);
    }
    const d = describe(this.events[i], ctx);
    if (d) { this.stepEl.textContent = `${i + 1}/${this.events.length} · ${d.step}`; this.txtEl.innerHTML = d.html; }
    this.prevBtn.disabled = i === 0;
    this.nextBtn.disabled = i === this.events.length - 1;
  }

  async replay() {
    this.replaying = !this.replaying;
    if (!this.replaying) { this.replayBtn.replaceChildren(icon("play"), t("Paso a paso")); return; }
    this.replayBtn.replaceChildren(icon("replay"), t("Detener"));
    for (let i = 0; i < this.events.length && this.replaying; i++) {
      this.stepTo(i);
      await sleep(i === 0 ? 700 : 1500);
    }
    this.replaying = false;
    this.replayBtn.replaceChildren(icon("play"), t("Paso a paso"));
  }

  snapshot() {
    return { pipeline: this.p, question: this.q, result: this.result, events: this.events, chunks: this.chunks };
  }
}
