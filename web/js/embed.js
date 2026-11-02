// Vista incrustable de una ejecución: el grafo animado y el recorrido de candidatos, en compacto.
// La usa Open WebUI (evento «embeds») bajo cada respuesta. URL: /embed/run/<id>?lang=va&theme=dark
import { getJSON } from "./api.js";
import { h, icon, fmtMs, short, PIPES, sleep } from "./ui.js";
import { t, setLang } from "./i18n.js";
import { PipelineGraph } from "./viz/pipeline.js";
import { RankFlow } from "./viz/flow.js";
import { describe } from "./narrate.js";

// Dos modos: por URL (/embed/run/<id>?lang=…), que pide los datos al servidor, o autocontenido (srcdoc), con el
// código, los estilos y los datos de la ejecución dentro del propio HTML (RAGLAB_EMBED).
const injected = window.RAGLAB_EMBED || null;
const params = new URLSearchParams(location.search);
const lang = injected?.lang || params.get("lang");
if (lang) setLang(lang);
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
const runId = injected?.run || location.pathname.split("/").filter(Boolean).pop();
const labBase = injected?.base || location.origin;

// El iframe va aislado (sin «same origin»): la altura se comunica a Open WebUI por postMessage.
const root = document.getElementById("embed");

// Alto fijo (la tarjeta mide 436 px, ver embed.html): se comunica tal cual, sin depender de medir el contenido,
// que en una pestaña en segundo plano o en un iframe aún sin ancho da valores erróneos.
const EMBED_HEIGHT = 444;
const reportHeight = () => parent.postMessage({ type: "iframe:height", height: EMBED_HEIGHT }, "*");
addEventListener("load", reportHeight);
[300, 2000].forEach((ms) => setTimeout(reportHeight, ms));   // por si Open WebUI aún no escuchaba al cargar

async function main() {
  let run;
  try { run = injected?.data || await getJSON(`/api/runs/${encodeURIComponent(runId)}`); }
  catch (e) { root.replaceChildren(h("div", { class: "card embed-card small muted" }, e.message)); return; }

  const events = run.events;
  const result = events.find((e) => e.type === "result");
  const start = events.find((e) => e.type === "start");
  const cfg = { ...(start?.config || {}) };
  const color = PIPES[run.pipeline].color;

  const graphBox = h("div", { class: "pipe-wrap" });
  const flowBox = h("div", { style: { overflowX: "auto" } });
  const stepEl = h("div", { class: "step" }, "—");
  const txtEl = h("div", { class: "txt" });
  const graph = new PipelineGraph(graphBox, run.pipeline, color);
  let cursor = events.length - 1, playing = false;

  // el recorrido de candidatos se reconstruye hasta el paso k (sus columnas aparecen al avanzar)
  const buildFlow = (k) => {
    const flow = new RankFlow(flowBox, run.pipeline, color);
    for (let j = 0; j <= k; j++) {
      const ev = events[j];
      flow.addChunks(ev.chunks);
      const first = ev.pass === 1 || ev.pass === undefined;
      if (!first) continue;
      if (ev.type === "dense" && !flow.cols.dense) flow.setStage("dense", ev.hits, t("coseno · {ms}", { ms: fmtMs(ev.ms) }));
      if (ev.type === "bm25" && !flow.cols.bm25) flow.setStage("bm25", ev.hits, t("{n} con términos", { n: ev.n }));
      if (ev.type === "fusion" && !flow.cols.rrf) flow.setStage("rrf", ev.hits, `k = ${ev.rrf_k}`);
      if (ev.type === "rerank" && !flow.cols.rerank) flow.setStage("rerank", ev.hits, `cross-encoder · ${fmtMs(ev.ms)}`);
      if (ev.type === "result") {
        const byRank = [...ev.contexts].sort((a, b) => a.rank - b.rank);
        flow.setStage("ctx", byRank.map((c) => ({ id: c.chunk_ids[0], s: c.score, n: c.n })), t("top-{n} · [n] en el prompt", { n: ev.contexts.length }));
      }
    }
  };

  const stepTo = (k) => {
    cursor = Math.max(0, Math.min(events.length - 1, k));
    graph.quiet = true;
    graph.reset();
    const ctx = { embeds: 0, config: cfg, nContexts: result?.contexts.length };
    for (let j = 0; j <= cursor; j++) {
      if (events[j].type === "embed") ctx.embeds += 1;
      if (j === cursor) graph.quiet = false;
      graph.apply(events[j], cfg);
    }
    const d = describe(events[cursor], ctx);
    if (d) { stepEl.textContent = `${cursor + 1}/${events.length} · ${d.step}`; txtEl.innerHTML = d.html; }
    if (active === "flow") buildFlow(cursor);
    prev.disabled = cursor === 0;
    next.disabled = cursor === events.length - 1;
  };

  const play = async () => {
    playing = !playing;
    playBtn.replaceChildren(icon(playing ? "replay" : "play"), playing ? t("Detener") : t("Paso a paso"));
    for (let i = 0; i < events.length && playing; i++) { stepTo(i); await sleep(i === 0 ? 500 : 1100); }
    playing = false;
    playBtn.replaceChildren(icon("play"), t("Paso a paso"));
  };

  const prev = h("button", { class: "icon-btn", "aria-label": t("Paso anterior"), onclick: () => stepTo(cursor - 1) }, icon("prev"));
  const next = h("button", { class: "icon-btn", "aria-label": t("Paso siguiente"), onclick: () => stepTo(cursor + 1) }, icon("next"));
  const playBtn = h("button", { class: "btn secondary sm", onclick: play }, icon("play"), t("Paso a paso"));

  // dos vistas: el proceso (grafo + narración) y el recorrido de los candidatos
  let active = "graph";
  const panes = { graph: h("div", {}, graphBox, h("div", { class: "narrative" }, stepEl, txtEl, h("div", { class: "ctl" }, prev, next, playBtn))), flow: flowBox };
  const body = h("div", {}, panes.graph);
  const tabs = h("div", { class: "subtabs", role: "tablist" }, [["graph", t("Ejecución")], ["flow", t("Recorrido de candidatos")]].map(([k, label]) =>
    h("button", { role: "tab", "aria-selected": k === active, onclick: (e) => {
      active = k;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b === e.currentTarget));
      body.replaceChildren(panes[k]);
      if (k === "flow") buildFlow(cursor);
    } }, label)));

  const lab = `${labBase}/#/ask?run=${encodeURIComponent(run.id)}`;
  root.replaceChildren(h("div", { class: "card embed-card", style: { "--pc": color } },
    h("div", { class: "embed-head" },
      h("div", { style: { minWidth: 0 } },
        h("div", { class: "eyebrow", style: { color } }, `RAG Lab · ${t(PIPES[run.pipeline].label)}`),
        h("h3", { translate: "no" }, short(run.question, 160))),
      result ? h("div", { class: "kpis" }, h("span", {}, t("Total") + " ", h("b", {}, fmtMs(result.total_ms)))) : null),
    tabs, body,
    h("div", { class: "embed-foot" },
      h("span", { class: "tiny muted" }, t("Eventos reales del servidor, en directo")),
      h("a", { href: lab, target: "_blank", rel: "noopener" }, t("Abrir en RAG Lab") + " ↗"))));

  stepTo(events.length - 1);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) play();
  reportHeight();
}
main();
