// Comparar: la misma pregunta en varias arquitecturas, lado a lado, con el análisis de en qué difieren.
import { streamRun } from "../api.js";
import { h, hero, icon, esc, fmtMs, short, bindTip, renderAnswer, toast, store, PIPES, PIPE_ORDER } from "../ui.js";
import { t } from "../i18n.js";
import { EXAMPLES, sourceCard, timingBar } from "./ask.js";
import { stagger } from "../motion.js";

const STEPS = {
  naive: ["embed", "dense", "result"],
  hybrid: ["embed", "bm25", "dense", "fusion", "candidates", "result"],
  advanced: ["embed", "bm25", "dense", "fusion", "candidates", "rerank", "result"],
  corrective: ["embed", "bm25", "dense", "fusion", "candidates", "rerank", "result"],
  agentic: ["agent_plan", "fusion", "rerank", "agent_obs", "agent_done", "result"],
};

export function compareView(root, state) {
  const st = state.status;
  const chosen = new Set(store("cmp.pipes") || PIPE_ORDER);
  let generate = st.llm.available && (store("generate") ?? true);
  let controller = null;

  const input = h("textarea", { rows: 1, placeholder: t("Una pregunta para todas las arquitecturas…") });
  const go = h("button", { class: "search-go", "aria-label": t("Comparar") }, icon("up"));
  const autosize = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
  go.addEventListener("click", () => run());
  const searchBox = h("div", { class: "search-box" }, input, go);

  const pick = h("div", { class: "chips" }, PIPE_ORDER.map((p) => {
    const b = h("button", { class: `chip${chosen.has(p) ? " active" : ""}`, onclick: () => {
      chosen.has(p) ? chosen.delete(p) : chosen.add(p);
      b.classList.toggle("active", chosen.has(p));
      store("cmp.pipes", [...chosen]);
    } }, h("span", { class: "dot", style: { background: PIPES[p].color } }), t(PIPES[p].label));
    return b;
  }));
  const out = h("div");
  root.append(
    hero(2, "Comparar", "Compara *arquitecturas*",
      t("La misma pregunta, varias familias de RAG. ¿Usan las mismas disposiciones? ¿Cuánto cuesta cada mejora?")),
    h("div", { class: "search" }, searchBox),
    h("div", { class: "toolbar" }, pick,
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: generate, disabled: !st.llm.available, onchange: (e) => { generate = e.target.checked; } }),
        st.llm.available ? t("Generar respuestas") : t("Sin LLM · solo retrieval"))),
    h("div", { class: "chips suggest" }, EXAMPLES.slice(0, 4).map((q) => h("button", { class: "chip", onclick: () => { input.value = q; autosize(); run(); } }, q))),
    out,
  );
  if (state.lastRun?.question) { input.value = state.lastRun.question; autosize(); }

  async function run() {
    const q = input.value.trim();
    if (!q) return;
    const pipes = PIPE_ORDER.filter((p) => chosen.has(p));
    if (!pipes.length) return toast(t("Elige al menos una arquitectura"));
    controller?.abort();
    controller = new AbortController();
    const cols = {};
    const grid = h("div", { class: "cmp-cols" });
    const analysis = h("div");
    out.replaceChildren(h("div", { class: "section-title" }, h("h2", {}, t("Respuestas")), h("span", { class: "small muted" }, t("Se ejecutan una detrás de otra"))), grid, analysis);
    for (const p of pipes) {
      const steps = [...STEPS[p], ...(generate ? ["llm"] : [])];
      const bar = h("div", { class: "mini-steps" }, steps.map((x) => h("span", { dataset: { s: x } })));
      const body = h("div", { class: "answer small", translate: "no" }, h("div", { class: "empty small" }, t("En cola…")));
      const meta = h("div");
      const srcs = h("div", { class: "sources", style: { marginTop: "12px" } });
      cols[p] = { bar, body, meta, srcs, steps, result: null };
      grid.append(h("div", { class: "card cmp-col", style: { "--pc": PIPES[p].color } },
        h("div", { class: "eyebrow", style: { color: PIPES[p].color } }, t(PIPES[p].label)),
        h("div", { class: "small muted" }, t(st.info[p].summary)), bar, body, meta, srcs));
    }
    const results = {};
    searchBox.classList.add("busy");
    for (const p of pipes) {
      const c = cols[p];
      c.body.replaceChildren(h("div", { class: "skeleton" }, h("span"), h("span"), h("span", { class: "short" })));
      const seen = new Set();
      try {
        await streamRun({ question: q, pipeline: p, generate }, (ev) => {
          const key = ev.type === "llm" && ev.purpose !== "answer" ? null : ev.type;
          if (key) seen.add(key);
          [...c.bar.children].forEach((sp, i) => {
            sp.className = seen.has(sp.dataset.s) ? "done" : (i === 0 || seen.has(c.steps[i - 1])) ? "active" : "";
          });
          if (ev.type === "result") { results[p] = ev; paintColumn(c, ev, p); }
          if (ev.type === "error") c.body.replaceChildren(h("div", { class: "abstain small" }, ev.message));
        }, controller.signal);
      } catch (e) {
        if (e.name === "AbortError") { searchBox.classList.remove("busy"); return; }
        c.body.replaceChildren(h("div", { class: "abstain small" }, e.message));
      }
    }
    searchBox.classList.remove("busy");
    paintAnalysis(analysis, results, pipes);
  }

  function paintColumn(c, ev, p) {
    if (ev.trace?.abstain) c.body.replaceChildren(h("div", { class: "abstain small" }, icon("shield"), h("div", {}, ev.answer)));
    else if (!ev.generated) c.body.replaceChildren(h("div", { class: "muted small" }, t("Solo retrieval: estos son los fragmentos que recibiría el LLM.")));
    else {
      c.body.innerHTML = renderAnswer(ev.answer);
      stagger(c.body);
      c.body.querySelectorAll(".cite").forEach((el) => {
        const target = () => c.srcs.querySelector(`[data-n="${el.dataset.n}"]`);
        el.addEventListener("mouseenter", () => target()?.classList.add("hl"));
        el.addEventListener("mouseleave", () => target()?.classList.remove("hl"));
      });
    }
    c.meta.replaceChildren(h("div", { class: "kpis", style: { marginTop: "10px" } },
      h("span", {}, t("Total") + " ", h("b", {}, fmtMs(ev.total_ms))),
      ev.trace?.verdict ? h("span", {}, t("Veredicto") + " ", h("b", {}, t({ correct: "correcto", ambiguous: "ambiguo", incorrect: "abstención" }[ev.trace.verdict] || ev.trace.verdict))) : null), timingBar(ev.timings));
    c.srcs.replaceChildren(...ev.contexts.map((ctx) => sourceCard(ctx, PIPES[p].color, { compact: true, chunker: p === "naive" ? "naive" : "advanced" })));
  }

  return { destroy: () => controller?.abort() };
}

function paintAnalysis(root, results, pipes) {
  const ok = pipes.filter((p) => results[p]);
  if (!ok.length) return;
  // disposiciones usadas por cada arquitectura (a nivel de disposición, como la evaluación)
  const docs = new Map();
  for (const p of ok) {
    results[p].contexts.forEach((c) => {
      const d = docs.get(c.code) || { code: c.code, title: c.title, ranks: {} };
      d.ranks[p] = Math.min(d.ranks[p] ?? 99, c.rank);
      docs.set(c.code, d);
    });
  }
  const rows = [...docs.values()].sort((a, b) => Object.keys(b.ranks).length - Object.keys(a.ranks).length ||
    Math.min(...Object.values(a.ranks)) - Math.min(...Object.values(b.ranks)));
  const matrix = h("div", { class: "table-wrap" }, h("table", { class: "t" },
    h("thead", {}, h("tr", {}, h("th", {}, t("Disposición")), ok.map((p) => h("th", { style: { textAlign: "center", color: PIPES[p].color } }, t(PIPES[p].label))))),
    h("tbody", {}, rows.map((d) => h("tr", { style: { cursor: "default" } },
      bindTip(h("td", {}, h("span", { class: "mono" }, d.code), h("div", { class: "tiny muted" }, short(d.title, 90))), `<b>${esc(d.code)}</b><br>${esc(d.title)}`),
      ok.map((p) => h("td", { style: { textAlign: "center", verticalAlign: "middle" } }, d.ranks[p]
        ? h("span", { style: { display: "inline-grid", placeItems: "center", width: "26px", height: "26px", borderRadius: "50%", background: PIPES[p].color, color: "#fff", font: "600 12px var(--font)", opacity: 1 - (d.ranks[p] - 1) * 0.12 } }, d.ranks[p])
        : h("span", { class: "muted" }, "·"))))))));

  // solapamiento (Jaccard) entre los conjuntos de disposiciones
  const sets = Object.fromEntries(ok.map((p) => [p, new Set(results[p].contexts.map((c) => c.code))]));
  const jac = (a, b) => { const A = sets[a], B = sets[b]; const i = [...A].filter((x) => B.has(x)).length; const u = new Set([...A, ...B]).size; return u ? i / u : 0; };
  const heat = h("div", { class: "table-wrap" }, h("table", { class: "t" },
    h("thead", {}, h("tr", {}, h("th", {}), ok.map((p) => h("th", { style: { textAlign: "center" } }, t(PIPES[p].label))))),
    h("tbody", {}, ok.map((a) => h("tr", { style: { cursor: "default" } }, h("th", {}, t(PIPES[a].label)), ok.map((b) => {
      const v = jac(a, b);
      return h("td", { style: { textAlign: "center", background: `color-mix(in srgb, var(--ink) ${Math.round(v * 22)}%, transparent)`, fontVariantNumeric: "tabular-nums" } }, v.toFixed(2));
    }))))));

  const maxT = Math.max(...ok.map((p) => results[p].total_ms));
  const times = h("div", { class: "grid", style: { gap: "10px" } }, ok.map((p) => h("div", {},
    h("div", { class: "small", style: { display: "flex", justifyContent: "space-between" } }, h("b", { style: { color: PIPES[p].color } }, t(PIPES[p].label)), h("span", { class: "mono" }, fmtMs(results[p].total_ms))),
    h("div", { style: { width: `${(results[p].total_ms / maxT) * 100}%`, minWidth: "40px" } }, timingBar(results[p].timings).firstChild))));

  root.replaceChildren(
    h("div", { class: "section-title" }, h("h2", {}, t("Análisis"))),
    h("div", { class: "split" },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Disposiciones en el contexto")),
        h("div", { class: "sub" }, t("El número es la posición por relevancia en cada arquitectura")))), matrix),
      h("div", { class: "grid" },
        h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Solapamiento")),
          h("div", { class: "sub" }, t("Índice de Jaccard entre las disposiciones que usa cada una")))), heat),
        h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Coste en tiempo")),
          h("div", { class: "sub" }, t("Barras proporcionales al tiempo total, por etapa")))), times))));
}
