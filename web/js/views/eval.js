// Evaluación del retrieval: hit@k, MRR y latencia, y en qué preguntas falla cada arquitectura.
import { getJSON, postJSON } from "../api.js";
import { h, hero, icon, seg, esc, fmtMs, short, bindTip, toast, store, download, PIPES, PIPE_ORDER } from "../ui.js";
import { t } from "../i18n.js";
import { grouped, barsH, legend } from "../viz/charts.js";

const KINDS = {
  titles: ["Títulos cruzados", "La consulta es el título oficial en el otro idioma (castellano contra el índice en valenciano). Sin LLM. Test de humo cross-lingual: favorece a los índices con el título en la cabecera, así que detecta fallos más que decidir entre arquitecturas."],
  synthetic: ["Preguntas sintéticas", "El LLM escribe una pregunta a partir de un chunk al azar; la respuesta correcta es su disposición. Más realista; revisa una muestra antes de fiarte."],
  custom: ["Mis preguntas", "Tu propio conjunto: una línea por pregunta con el código de la disposición que la responde, separados por «|»."],
};

export function evalView(root, state) {
  const st = state.status;
  let kind = "titles";
  let n = 30;
  const chosen = new Set(store("eval.pipes") || ["naive", "hybrid", "advanced"]);
  let timer = null;

  const desc = h("p", { class: "small muted", style: { margin: "4px 0 0" } }, t(KINDS[kind][1]));
  const custom = h("textarea", { class: "input hidden", placeholder: "Quines ajudes hi ha per al multilingüisme? | 2026/31509\n¿Qué se publica sobre centros oncológicos? | 2026/31265" });
  const nVal = h("span", { class: "range-val" }, n);
  const nRow = h("div", { class: "field" }, h("label", {}, t("Número de preguntas")),
    h("div", { class: "range-row" }, h("input", { type: "range", min: 5, max: 150, step: 5, value: n, oninput: (e) => { n = +e.target.value; nVal.textContent = n; } }), nVal));
  const pick = h("div", { class: "chips" }, PIPE_ORDER.map((p) => {
    const b = h("button", { class: `chip${chosen.has(p) ? " active" : ""}`, onclick: () => {
      chosen.has(p) ? chosen.delete(p) : chosen.add(p); b.classList.toggle("active", chosen.has(p)); store("eval.pipes", [...chosen]);
    } }, h("span", { class: "dot", style: { background: PIPES[p].color } }), t(PIPES[p].label));
    return b;
  }));
  const runBtn = h("button", { class: "btn", onclick: start }, icon("flask"), t("Evaluar"));
  const progress = h("div");
  const out = h("div");

  root.append(
    hero(5, "Evaluación", "¿Qué *recupera* cada una?",
      t("¿Encuentra cada arquitectura la disposición que contiene la respuesta? Medido a nivel de disposición, como en el notebook.")),
    h("div", { class: "card" },
      h("div", { class: "grid g2", style: { gap: "18px" } },
        h("div", { class: "field" }, h("label", {}, t("Conjunto de preguntas")),
          seg(Object.entries(KINDS).map(([k, v]) => [k, t(v[0])]), kind, (v) => {
            kind = v; desc.textContent = t(KINDS[v][1]);
            custom.classList.toggle("hidden", v !== "custom"); nRow.classList.toggle("hidden", v === "custom");
            if (v === "synthetic" && !st.llm.available) toast(t("Las preguntas sintéticas necesitan un LLM conectado"));
          }), desc, custom),
        h("div", { class: "grid", style: { gap: "14px" } }, nRow,
          h("div", { class: "field" }, h("label", {}, t("Arquitecturas")), pick),
          h("p", { class: "tiny muted", style: { margin: 0 } }, t("Corrective sin LLM equivale a Advanced en retrieval. Con reranker en CPU, cada pregunta tarda unos segundos.")))),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", alignItems: "center", marginTop: "16px" } }, progress, runBtn)),
    out,
    metricsHelp(),
  );

  async function start() {
    const pipes = PIPE_ORDER.filter((p) => chosen.has(p));
    if (!pipes.length) return toast(t("Elige al menos una arquitectura"));
    let customSet = null;
    if (kind === "custom") {
      customSet = custom.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x.length === 2 && x[0] && x[1])
        .map(([question, code]) => ({ question, code }));
      if (!customSet.length) return toast(t("Escribe al menos una línea «pregunta | código»"));
    }
    runBtn.disabled = true;
    try {
      const { id } = await postJSON("/api/eval", { kind, n, pipelines: pipes, custom: customSet });
      poll(id, pipes);
    } catch (e) { toast(e.message); runBtn.disabled = false; }
  }

  function poll(id, pipes) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let job;
      try { job = await getJSON(`/api/eval/${id}`); } catch (e) { toast(e.message); runBtn.disabled = false; return; }
      const frac = job.total ? job.done / job.total : 0;
      progress.replaceChildren(h("span", { class: "small muted" }, job.status === "running" ? `${t(job.message)} ${job.done}/${job.total}` : job.status === "error" ? "" : t("Completado en {s} s", { s: job.elapsed })),
        job.status === "running" ? h("div", { class: "progress", style: { width: "160px", margin: 0 } }, h("span", { style: { width: `${frac * 100}%` } })) : null);
      if (job.status === "running") return poll(id, pipes);
      runBtn.disabled = false;
      if (job.status === "error") { toast(job.error, 5000); progress.replaceChildren(h("span", { class: "badge bad" }, "Error"), h("span", { class: "small" }, " ", job.error)); return; }
      paintResults(out, job, pipes);
    }, 700);
  }
  return { destroy: () => clearTimeout(timer) };
}

function paintResults(root, job, pipes) {
  const sum = job.summary;
  const ks = Object.keys(sum[0]).filter((k) => k.startsWith("hit@"));
  const mrrKey = Object.keys(sum[0]).find((k) => k.startsWith("MRR"));
  const series = sum.map((r) => ({ name: t(PIPES[r.pipeline].label), color: PIPES[r.pipeline].color, values: [...ks.map((k) => r[k]), r[mrrKey]] }));
  const best = Object.fromEntries([...ks, mrrKey].map((k) => [k, Math.max(...sum.map((r) => r[k]))]));

  const ci = bootstrap(job.detail, pipes);
  const table = h("div", { class: "table-wrap" }, h("table", { class: "t" },
    h("thead", {}, h("tr", {}, h("th", {}, t("Arquitectura")), [...ks, mrrKey].map((k) => h("th", { class: "num" }, k)), h("th", { class: "num" }, t("IC 95% MRR")), h("th", { class: "num" }, t("s/consulta")))),
    h("tbody", {}, sum.map((r) => h("tr", { style: { cursor: "default" } },
      h("td", {}, h("span", { class: "dot", style: { background: PIPES[r.pipeline].color, display: "inline-block", marginRight: "8px" } }), t(PIPES[r.pipeline].label)),
      [...ks, mrrKey].map((k) => h("td", { class: "num", style: { fontWeight: r[k] === best[k] ? 700 : 400 } }, r[k].toFixed(3))),
      h("td", { class: "num muted nowrap" }, `${ci.ci[r.pipeline][0].toFixed(2)}–${ci.ci[r.pipeline][1].toFixed(2)}`),
      h("td", { class: "num" }, fmtMs(r["s/consulta"] * 1000)))))));
  const pairs = ci.pairs.length ? h("div", { class: "small ink2", style: { marginTop: "12px" } },
    h("div", { class: "label", style: { marginBottom: "4px" } }, t("Comparación pareada (bootstrap, 2.000 remuestreos)")),
    ci.pairs.map(([a, b, pr, diff]) => h("div", {}, h("b", { style: { color: PIPES[a].color } }, t(PIPES[a].label)), " " + t("supera a") + " ",
      h("b", { style: { color: PIPES[b].color } }, t(PIPES[b].label)), " " + t("en MRR en el {pct}% de los remuestreos (Δ = {d})", { pct: Math.round(pr * 100), d: `${diff >= 0 ? "+" : ""}${diff.toFixed(3)}` }))),
    h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, t("Por encima del 95% la diferencia es robusta a qué preguntas se hayan muestreado; con pocas preguntas los intervalos son anchos."))) : null;

  // pregunta a pregunta
  const byQ = new Map();
  for (const d of job.detail) {
    if (!byQ.has(d.question)) byQ.set(d.question, { question: d.question, code: d.code, ranks: {} });
    byQ.get(d.question).ranks[d.pipeline] = d.rank;
  }
  const rows = [...byQ.values()].sort((a, b) => {
    const score = (x) => pipes.reduce((s, p) => s + (x.ranks[p] ? 1 / x.ranks[p] : 0), 0);
    return score(a) - score(b);
  });
  const cell = (r) => {
    if (r == null) return h("span", { class: "badge bad" }, "✕");
    const f = Math.min(1, (r - 1) / 9);
    return h("span", { style: { display: "inline-grid", placeItems: "center", width: "26px", height: "22px", borderRadius: "6px", font: "600 12px var(--font)",
      background: `color-mix(in srgb, var(--good) ${Math.round((1 - f) * 70 + 10)}%, var(--sunken))`, color: r <= 3 ? "#fff" : "var(--ink)" } }, r);
  };
  const detail = h("div", { class: "table-wrap", style: { maxHeight: "520px", overflowY: "auto" } }, h("table", { class: "t" },
    h("thead", {}, h("tr", {}, h("th", {}, t("Pregunta")), h("th", {}, t("Disposición")), pipes.map((p) => h("th", { style: { textAlign: "center", color: PIPES[p].color } }, t(PIPES[p].label))))),
    h("tbody", {}, rows.map((r) => h("tr", { style: { cursor: "default" } },
      bindTip(h("td", { translate: "no" }, short(r.question, 110)), esc(r.question)), h("td", { class: "mono nowrap" }, r.code.replace("_", "/")),
      pipes.map((p) => h("td", { style: { textAlign: "center" } }, cell(r.ranks[p]))))))));

  const csv = () => "pipeline,question,code,rank,seconds\n" + job.detail.map((d) =>
    [d.pipeline, `"${d.question.replace(/"/g, '""')}"`, d.code, d.rank ?? "", d.seconds.toFixed(4)].join(",")).join("\n");

  root.replaceChildren(
    h("div", { class: "section-title" }, h("h2", {}, t("Resultados")),
      h("button", { class: "btn secondary sm", onclick: () => download(`evaluacion_${job.kind}.csv`, csv()) }, icon("download"), "CSV")),
    h("div", { class: "split" },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("hit@k y MRR")), h("div", { class: "sub" }, t("{n} preguntas · más alto es mejor", { n: job.detail.length / pipes.length })))),
        grouped([...ks, mrrKey], series, { width: 640, height: 280 }), legend(series.map((s) => [s.name, s.color]))),
      h("div", { class: "grid" },
        h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, t("Tabla"))), table, pairs),
        h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Latencia del retrieval")), h("div", { class: "sub" }, t("Segundos por consulta (sin generación)")))),
          barsH(sum.map((r) => ({ label: t(PIPES[r.pipeline].label), value: r["s/consulta"] * 1000, color: PIPES[r.pipeline].color })), { fmt: fmtMs, labelW: 100, width: 460 })))),
    h("div", { class: "card", style: { marginTop: "16px" } },
      h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Pregunta a pregunta")),
        h("div", { class: "sub" }, t("Posición de la disposición correcta (✕ = fuera del top 10). Arriba, las más difíciles.")))), detail),
  );
}

/** Intervalos de confianza del MRR por bootstrap y comparación pareada entre arquitecturas. */
function bootstrap(detail, pipes, B = 2000) {
  const byQ = new Map();
  for (const d of detail) {
    if (!byQ.has(d.question)) byQ.set(d.question, {});
    byQ.get(d.question)[d.pipeline] = d.rank ? 1 / d.rank : 0;
  }
  const qs = [...byQ.values()].filter((x) => pipes.every((p) => p in x));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const samples = Object.fromEntries(pipes.map((p) => [p, []]));
  for (let b = 0; b < B; b++) {
    const acc = Object.fromEntries(pipes.map((p) => [p, 0]));
    for (let i = 0; i < qs.length; i++) { const q = qs[Math.floor(rnd() * qs.length)]; for (const p of pipes) acc[p] += q[p]; }
    for (const p of pipes) samples[p].push(acc[p] / qs.length);
  }
  const q = (a, x) => [...a].sort((u, v) => u - v)[Math.floor(x * (a.length - 1))];
  const ci = Object.fromEntries(pipes.map((p) => [p, [q(samples[p], 0.025), q(samples[p], 0.975)]]));
  const mean = (p) => qs.reduce((s, x) => s + x[p], 0) / (qs.length || 1);
  const pairs = [];
  for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
    let [a, b] = [pipes[i], pipes[j]];
    if (mean(b) > mean(a)) [a, b] = [b, a];
    const wins = samples[a].filter((v, k) => v > samples[b][k]).length / B;
    pairs.push([a, b, wins, mean(a) - mean(b)]);
  }
  return { ci, pairs };
}

function metricsHelp() {
  return h("div", { class: "card flat", style: { marginTop: "24px", background: "transparent" } },
    h("div", { class: "grid g3" },
      h("div", {}, h("h3", {}, "hit@k"), h("p", { class: "small ink2" }, t("Proporción de preguntas en las que la disposición correcta aparece entre las k primeras (contando cualquiera de sus chunks).")),
        h("div", { class: "formula" }, "hit@k = (1/|Q|) Σ 𝟙[rank_q ≤ k]")),
      h("div", {}, h("h3", {}, "MRR@10"), h("p", { class: "small ink2" }, t("Media del inverso de la posición de la primera disposición correcta; 0 si no está en el top 10. Premia acertar arriba.")),
        h("div", { class: "formula" }, "MRR = (1/|Q|) Σ 1 / rank_q")),
      h("div", {}, h("h3", {}, t("Latencia")), h("p", { class: "small ink2" }, t("Tiempo medio del retrieval (embedding, búsqueda, fusión y reranking). La generación se mide aparte en Preguntar y Comparar.")))));
}
