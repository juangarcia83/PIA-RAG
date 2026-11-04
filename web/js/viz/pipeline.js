// Grafo animado de las etapas de cada arquitectura. Los nodos se iluminan con los eventos reales
// que emite el servidor y una partícula recorre cada arista cuando una etapa termina.
import { t } from "../i18n.js";
import { s, fmtMs, fmtScore, bindTip, esc } from "../ui.js";

const fmtNumK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`) + " car.";

const W = 122, H = 58, GX = 134, GY = 78, PAD = 14;

const N = {
  q: { label: "Consulta", icon: "M5 5h14v10H9l-4 4z", help: "La pregunta tal como la escribe el usuario." },
  embed: { label: "Embedding", icon: "M4 20L20 4M14 4h6v6", help: "El bi-encoder convierte la consulta en un vector normalizado." },
  tok: { label: "Tokenizado", icon: "M5 6h14M9 6v12M15 6v12", help: "Minúsculas, sin acentos ni stopwords y stemming Snowball (catalán)." },
  dense: { label: "Denso", icon: "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7", help: "Similitud coseno entre la consulta y todos los chunks (búsqueda exacta)." },
  bm25: { label: "BM25", icon: "M4 6h16M4 12h10M4 18h7", help: "Ranking léxico: términos de la consulta presentes en el chunk, ponderados por IDF y longitud." },
  rrf: { label: "Fusión RRF", icon: "M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v3M18 4v5a4 4 0 0 1-4 4", help: "Reciprocal Rank Fusion: suma 1/(k+rango) de cada lista; ignora la escala de los scores." },
  cand: { label: "Dedup · top-N", icon: "M4 6h16M7 12h10M10 18h4", help: "Quita textos duplicados, conserva un idioma por disposición y corta a los N candidatos." },
  rerank: { label: "Reranker", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6", help: "Cross-encoder: lee consulta y chunk juntos y puntúa su relevancia (0-1)." },
  gate: { label: "Evaluador", icon: "M4 18a8 8 0 1 1 16 0M12 18l4-6", help: "Compara el mejor score del reranker con τ_ok y τ_abstain." },
  rewrite: { label: "Reformular", icon: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4", help: "El LLM reformula la pregunta y escribe un párrafo hipotético; se busca otra vez." },
  ctx: { label: "Contexto", icon: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5", help: "Top-k fragmentos, reordenados (lost in the middle) y recortados al presupuesto." },
  llm: { label: "LLM", icon: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", help: "Genera la respuesta citando los fragmentos [n]." },
  agent: { label: "Agente", icon: "M9 4h6v3H9zM6 7h12v11H6zM9.5 11.5h.01M14.5 11.5h.01M10 15h4M12 4V2", help: "Un LLM planifica: en cada paso elige buscar, leer una evidencia entera o terminar." },
  search: { label: "Búsqueda", icon: "M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5", help: "Búsqueda híbrida (BM25 + denso, RRF) con la consulta y los filtros que decide el agente." },
  read: { label: "Leer", icon: "M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z", help: "El agente lee entera una evidencia (con sus chunks vecinos) antes de decidir." },
  obs: { label: "Evidencias", icon: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5", help: "Resultados que vuelven al agente como observación (E1, E2…). Al terminar, elige cuáles entran al contexto." },
};

export const GRAPHS = {
  naive: {
    nodes: { q: [0, 0], embed: [1, 0], dense: [2, 0], ctx: [3, 0], llm: [4, 0] },
    edges: [["q", "embed"], ["embed", "dense"], ["dense", "ctx"], ["ctx", "llm"]],
  },
  hybrid: {
    nodes: { q: [0, 0.5], embed: [1, 0], tok: [1, 1], dense: [2, 0], bm25: [2, 1], rrf: [3, 0.5], cand: [4, 0.5], ctx: [5, 0.5], llm: [6, 0.5] },
    edges: [["q", "embed"], ["q", "tok"], ["embed", "dense"], ["tok", "bm25"], ["dense", "rrf"], ["bm25", "rrf"], ["rrf", "cand"], ["cand", "ctx"], ["ctx", "llm"]],
  },
  advanced: {
    nodes: { q: [0, 0.5], embed: [1, 0], tok: [1, 1], dense: [2, 0], bm25: [2, 1], rrf: [3, 0.5], cand: [4, 0.5], rerank: [5, 0.5], ctx: [6, 0.5], llm: [7, 0.5] },
    edges: [["q", "embed"], ["q", "tok"], ["embed", "dense"], ["tok", "bm25"], ["dense", "rrf"], ["bm25", "rrf"], ["rrf", "cand"], ["cand", "rerank"], ["rerank", "ctx"], ["ctx", "llm"]],
  },
  corrective: {
    nodes: { q: [0, 0.5], embed: [1, 0], tok: [1, 1], dense: [2, 0], bm25: [2, 1], rrf: [3, 0.5], cand: [4, 0.5], rerank: [5, 0.5], gate: [6, 0.5], rewrite: [6, 1.75], ctx: [7, 0.5], llm: [8, 0.5] },
    edges: [["q", "embed"], ["q", "tok"], ["embed", "dense"], ["tok", "bm25"], ["dense", "rrf"], ["bm25", "rrf"], ["rrf", "cand"], ["cand", "rerank"], ["rerank", "gate"], ["gate", "ctx"], ["gate", "rewrite", "si es flojo"], ["rewrite", "tok", "2ª pasada", "loop"], ["ctx", "llm"]],
  },
  agentic: {
    nodes: { q: [0, 0.5], agent: [1, 0.5], search: [2, 0], rerank: [3, 0], read: [2.5, 1], obs: [4, 0.5], ctx: [5, 0.5], llm: [6, 0.5] },
    edges: [["q", "agent"], ["agent", "search"], ["search", "rerank"], ["rerank", "obs"], ["agent", "read"], ["read", "obs"], ["obs", "agent", "siguiente paso", "loop"], ["obs", "ctx"], ["ctx", "llm"]],
  },
};

export class PipelineGraph {
  constructor(container, pipeline, color) {
    this.container = container;
    this.pipeline = pipeline;
    this.color = color;
    this.graph = GRAPHS[pipeline];
    this.state = {};
    this.meta = {};
    this.render();
  }

  pos(id) {
    const [c, r] = this.graph.nodes[id];
    return { x: PAD + c * GX, y: PAD + 10 + r * GY };
  }

  edgePath(a, b, loop) {
    const pa = this.pos(a), pb = this.pos(b);
    if (loop) {   // vuelta atrás (reformular, siguiente paso del agente), por debajo de todo el grafo
      const y = this.loopY();
      return `M${pa.x + W / 2},${pa.y + H} L${pa.x + W / 2},${y - 10} Q${pa.x + W / 2},${y} ${pa.x + W / 2 - 10},${y} L${pb.x + W / 2 + 10},${y} Q${pb.x + W / 2},${y} ${pb.x + W / 2},${y - 10} L${pb.x + W / 2},${pb.y + H}`;
    }
    if (Math.abs(pa.x - pb.x) < 1) return `M${pa.x + W / 2},${pa.y + H} L${pb.x + W / 2},${pb.y}`;
    const x1 = pa.x + W, y1 = pa.y + H / 2, x2 = pb.x, y2 = pb.y + H / 2, mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  loopY() {
    return Math.max(...Object.keys(this.graph.nodes).map((id) => this.pos(id).y)) + H + 26;
  }

  render() {
    const cols = Math.max(...Object.values(this.graph.nodes).map((p) => p[0])) + 1;
    const rows = Math.max(...Object.values(this.graph.nodes).map((p) => p[1]));
    const width = PAD * 2 + (cols - 1) * GX + W;
    const height = PAD * 2 + 10 + rows * GY + H + (this.graph.edges.some((e) => e[3]) ? 34 : 4);
    this.svg = s("svg", { class: "pipe-svg", viewBox: `0 0 ${width} ${height}`, style: `--pc:${this.color}`, role: "img",
      "aria-label": t("Etapas de la arquitectura {name}", { name: this.pipeline }) });
    this.svg.style.minWidth = `${Math.min(width, 1100) * 0.82}px`;
    this.edgesG = s("g");
    this.nodesG = s("g");
    this.fxG = s("g");
    this.svg.append(this.edgesG, this.nodesG, this.fxG);
    this.edgeEls = [];
    for (const [a, b, label, loop] of this.graph.edges) {
      const d = this.edgePath(a, b, loop);
      const path = s("path", { class: `pedge${loop ? " dashed" : ""}`, d });
      this.edgesG.append(path);
      this.edgeEls.push({ a, b, path, loop: !!loop });
      if (label) {
        const pa = this.pos(a), pb = this.pos(b);
        const lx = loop ? (pa.x + pb.x) / 2 + W / 2 : pa.x + W / 2 + 6;
        const ly = loop ? this.loopY() - 4 : (pa.y + H + pb.y) / 2 + 4;
        this.edgesG.append(s("text", { class: "pedge-label", x: lx, y: ly, "text-anchor": loop ? "middle" : "start" }, t(label)));
      }
    }
    this.nodeEls = {};
    for (const id of Object.keys(this.graph.nodes)) {
      const { x, y } = this.pos(id);
      const def = N[id];
      const g = s("g", { class: "pnode", transform: `translate(${x},${y})`, tabindex: 0 });
      g.append(
        s("rect", { class: "box", width: W, height: H, rx: 10 }),
        s("svg", { x: 10, y: 10, width: 16, height: 16, viewBox: "0 0 24 24" }, s("path", { class: "ic", d: def.icon })),
        s("text", { class: "lbl", x: 32, y: 23 }, t(def.label)),
        s("text", { class: "meta", x: 11, y: 44 }, ""),
      );
      bindTip(g, () => `<b>${esc(t(def.label))}</b><br>${esc(t(def.help))}${this.meta[id]?.tip ? `<div style="margin-top:6px">${this.meta[id].tip}</div>` : ""}`);
      this.nodesG.append(g);
      this.nodeEls[id] = g;
    }
    this.container.replaceChildren(this.svg);
    this.reset();
  }

  reset() {
    this.state = {};
    this.meta = {};
    this.agent = { steps: 0, refs: new Set() };
    for (const [id, g] of Object.entries(this.nodeEls)) {
      g.setAttribute("class", "pnode");
      g.querySelector(".meta").textContent = "";
    }
    this.edgeEls.forEach((e) => e.path.classList.remove("done"));
    this.fxG.replaceChildren();
  }

  set(id, state, metaText, tip) {
    const g = this.nodeEls[id];
    if (!g) return;
    this.state[id] = state;
    g.setAttribute("class", `pnode ${state}`);
    if (metaText !== undefined) g.querySelector(".meta").textContent = metaText;
    if (tip) this.meta[id] = { tip };
  }

  /** Marca el nodo como hecho y anima sus aristas de salida (todas, o solo las que van a `to`). */
  done(id, metaText, tip, { particles = true, variant, to } = {}) {
    if (!this.nodeEls[id]) return;
    this.set(id, variant || "done", metaText, tip);
    const confident = id === "gate" && variant !== "warn";   // retrieval bueno: no se reformula
    for (const e of this.edgeEls) {
      if (e.a !== id || (confident && e.b === "rewrite") || (to && !to.includes(e.b))) continue;
      e.path.classList.add("done");
      if (particles) this.particle(e.path);
      if (!e.loop && !this.state[e.b]) this.set(e.b, "active");
    }
  }

  particle(path) {
    if (this.quiet || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const len = path.getTotalLength();
    const dot = s("circle", { class: "particle", r: 4 });
    this.fxG.append(dot);
    const t0 = performance.now(), dur = Math.min(900, 300 + len * 1.4);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const p = path.getPointAtLength(e * len);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("opacity", k > 0.9 ? (1 - k) * 10 : 1);
      if (k < 1) requestAnimationFrame(step);
      else dot.remove();
    };
    requestAnimationFrame(step);
  }

  focus(id) {
    Object.entries(this.nodeEls).forEach(([k, g]) => g.classList.toggle("focus", k === id));
  }

  /** Traduce un evento del servidor al estado del grafo. */
  apply(ev, cfg) {
    const ms = ev.ms != null ? fmtMs(ev.ms) : "";
    switch (ev.type) {
      case "start":
        this.reset();
        this.done("q", ev.filters && Object.keys(ev.filters).length ? t("filtro: {n} chunks", { n: ev.filtered_chunks }) : "", null);
        break;
      case "embed":
        this.done("embed", `${ev.dim} d · ${ms}`, t("Vector de {dim} dimensiones (norma {norm}).", { dim: ev.dim, norm: ev.norm }));
        break;
      case "bm25":
        this.done("tok", t("{n} términos", { n: ev.tokens.length }), ev.tokens.map((x) => `<code>${esc(x)}</code>`).join(" "), { particles: true });
        this.done("bm25", `${ev.n} hits · ${ms}`);
        break;
      case "dense":
        this.done("dense", `top ${ev.n} · ${ms}`);
        break;
      case "fusion":
        this.done("rrf", t("{n} listas · {k}", { n: ev.lists.length, k: ev.n }));
        break;
      case "candidates":
        this.done("cand", t("{n} candidatos", { n: ev.n }));
        this.done("search", t("{n} candidatos", { n: ev.n }), null, { to: ["rerank"] });
        break;
      case "rerank": {
        this.done("rerank", `${ev.hits.length} · ${ms}`);
        if (this.nodeEls.gate && ev.pass === 1) {
          const best = ev.hits[0]?.s ?? 0;
          const ok = best >= (cfg?.tau_ok ?? 0.5);
          this.done("gate", `max ${fmtScore(best, 2)} ${ok ? "≥" : "<"} τ`, null, { variant: ok ? "done" : "warn" });
        }
        break;
      }
      case "llm_start":
        if (ev.purpose === "agent") { this.agent.steps += 1; this.set("agent", "active", t("pensando · paso {n}", { n: this.agent.steps })); }
        else if (ev.purpose === "answer") { this.done("ctx", ""); this.set("llm", "active", t("generando…")); }
        else if (this.nodeEls.rewrite) this.set("rewrite", "active", ev.purpose === "hyde" ? "HyDE…" : t("reformulando…"));
        break;
      case "agent_plan": {
        const what = { search: t("buscar"), read: t("leer"), finish: t("terminar") }[ev.action];
        const tip = ev.thought ? `«${esc(ev.thought)}»` : null;
        this.done("agent", `${ev.step}/${ev.max_steps} · ${what}`, tip, { to: ev.action === "search" ? ["search"] : ev.action === "read" ? ["read"] : [] });
        if (ev.action === "search") this.set("search", "active", ev.query.length > 18 ? ev.query.slice(0, 17) + "…" : ev.query, `«${esc(ev.query)}»`);
        break;
      }
      case "agent_obs": {
        (ev.results || []).forEach((x) => this.agent.refs.add(x.ref));
        if (ev.action === "read") this.done("read", ev.ok ? `${ev.ref} · ${fmtNumK(ev.chars)}` : t("ref no válida"), null, { to: ["obs"] });
        else if (this.state.search === "active") this.done("search", ev.duplicate ? t("repetida") : t("{n} candidatos", { n: 0 }), null, { to: ["obs"] });
        this.done("obs", t("{n} evidencias", { n: this.agent.refs.size }), null, { to: ["agent"] });
        break;
      }
      case "agent_done":
        this.done("obs", t("{n} elegidas de {m}", { n: ev.evidence.length, m: ev.n_pool }), null, { to: ev.abstain ? [] : ["ctx"] });
        break;
      case "llm":
        if (ev.purpose === "agent") break;
        if (ev.purpose === "answer") this.done("llm", ms);
        else if (this.nodeEls.rewrite) this.done("rewrite", ms, null, { particles: ev.purpose === "hyde" || !cfg?.use_hyde });
        break;
      case "result": {
        const verdict = ev.trace?.verdict;
        if (this.nodeEls.gate && verdict) {
          const v = verdict === "incorrect" ? "bad" : verdict === "ambiguous" ? "warn" : this.state.gate || "done";
          const best = ev.trace.second_pass_best ?? ev.trace.first_pass_best;
          this.set("gate", v, `${t({ correct: "correcto", ambiguous: "ambiguo", incorrect: "abstención" }[verdict] || verdict)} · ${fmtScore(best, 2)}`);
        }
        if (this.nodeEls.obs && this.state.obs === "active") this.set("obs", "done");
        if (ev.trace?.abstain) { this.set("ctx", "skipped", "—"); this.set("llm", "skipped", t("se abstiene")); }
        else {
          if (this.state.ctx !== "done") this.done("ctx", t("{n} fragmentos", { n: ev.contexts.length }), null, { particles: ev.generated });
          else this.set("ctx", "done", t("{n} fragmentos", { n: ev.contexts.length }));
          if (!ev.generated) this.set("llm", "skipped", t("sin LLM"));
        }
        for (const id of Object.keys(this.nodeEls)) if (!this.state[id] || this.state[id] === "active") this.set(id, "skipped");
        break;
      }
      case "error":
        for (const id of Object.keys(this.nodeEls)) if (this.state[id] === "active") this.set(id, "bad", t("error"));
        break;
    }
  }
}
