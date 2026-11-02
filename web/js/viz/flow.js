// Recorrido de los candidatos: una columna por etapa (denso, BM25, RRF, reranker, contexto) y una línea
// que une el mismo chunk entre etapas. Muestra qué aporta cada rama y cuánto reordena el reranker.
import { t } from "../i18n.js";
import { s, h, fmtScore, showTip, moveTip, hideTip, chunkTip } from "../ui.js";

const ROWS = 12, ROW_H = 27, TOP = 46, NODE_W = 150;

const FEEDS = { rrf: ["dense", "bm25"], rerank: ["rrf"], ctx: ["rerank", "rrf", "dense"] };
const ORDER = {
  naive: ["dense", "ctx"],
  hybrid: ["dense", "bm25", "rrf", "ctx"],
  advanced: ["dense", "bm25", "rrf", "rerank", "ctx"],
  corrective: ["dense", "bm25", "rrf", "rerank", "ctx"],
  agentic: ["dense", "bm25", "rrf", "rerank", "ctx"],   // la primera búsqueda del agente
};
const LABELS = { dense: "Denso", bm25: "BM25", rrf: "Fusión RRF", rerank: "Reranker", ctx: "Contexto" };
const label = (k) => t(LABELS[k]);

export class RankFlow {
  constructor(container, pipeline, color) {
    this.container = container;
    this.pipeline = pipeline;
    this.color = color;
    this.order = ORDER[pipeline];
    this.cols = {};
    this.chunks = {};
    this.lastAdded = null;
    this.render();
  }

  addChunks(meta) { Object.assign(this.chunks, meta || {}); }

  /** items: [{id, s}] ordenados. sub: texto bajo el título de la columna. */
  setStage(key, items, sub) {
    if (!this.order.includes(key)) return;
    this.cols[key] = { items: items.slice(0, ROWS), all: items, sub };
    this.lastAdded = key;
    this.render();
  }

  rankIn(key, id) {
    const c = this.cols[key];
    if (!c) return null;
    const i = c.all.findIndex((x) => x.id === id);
    return i < 0 ? null : i + 1;
  }

  render() {
    const keys = this.order;
    const width = 980;
    const colW = width / keys.length;
    const height = TOP + ROWS * ROW_H + 10;
    const svg = s("svg", { class: "flow-svg", viewBox: `0 0 ${width} ${height}`, style: `--pc:${this.color}` });
    const ctxIds = new Set((this.cols.ctx?.items || []).map((x) => x.id));
    const x0 = (k) => keys.indexOf(k) * colW + (colW - NODE_W) / 2;
    const yOf = (r) => TOP + (r - 1) * ROW_H;
    const linksG = s("g"), nodesG = s("g");
    svg.append(linksG, nodesG);

    keys.forEach((k, ci) => {
      const cx = ci * colW + colW / 2;
      const col = this.cols[k];
      nodesG.append(
        s("text", { class: "flow-col-title", x: cx, y: 16, "text-anchor": "middle" }, label(k)),
        s("text", { class: "flow-col-sub", x: cx, y: 31, "text-anchor": "middle" }, col ? col.sub || "" : t("esperando…")),
      );
      if (!col) {
        nodesG.append(s("rect", { x: x0(k), y: TOP, width: NODE_W, height: ROWS * ROW_H - 6, rx: 4, fill: "none",
          stroke: "var(--line-strong)", "stroke-dasharray": "4 5" }));
        return;
      }
      const fresh = this.lastAdded === k;
      col.items.forEach((it, i) => {
        const meta = this.chunks[it.id];
        // la posición va en un <g> exterior: una animación CSS con transform pisaría el atributo transform
        const g = s("g", { class: `flow-node${ctxIds.has(it.id) ? " ctx" : ""}`, "data-id": it.id, transform: `translate(${x0(k)},${yOf(i + 1)})` });
        const inner = s("g", { class: fresh ? "pop" : null, style: fresh ? `animation-delay:${i * 25}ms` : null });
        g.append(inner);
        const label = meta ? meta.code + (meta.idx ? ` · ${meta.idx + 1}` : "") : `#${it.id}`;
        inner.append(
          s("rect", { width: NODE_W, height: ROW_H - 6, rx: 6 }),
          s("text", { x: 8, y: 14.5 }, label),
          s("text", { class: "sc", x: NODE_W - 7, y: 14.5, "text-anchor": "end" }, k === "ctx" ? `[${it.n ?? i + 1}]` : fmtScore(it.s, k === "rrf" ? 3 : 2)),
        );
        g.addEventListener("mouseenter", (e) => this.hover(svg, it.id, e));
        g.addEventListener("mousemove", moveTip);
        g.addEventListener("mouseleave", () => this.hover(svg, null));
        nodesG.append(g);
      });
      // enlaces desde las columnas que alimentan a esta
      const feeds = (FEEDS[k] || []).filter((f) => this.cols[f] && keys.includes(f));
      const sources = k === "ctx" ? feeds.slice(0, 1) : feeds;
      for (const f of sources) {
        const src = this.cols[f];
        col.items.forEach((it, i) => {
          const j = src.items.findIndex((x) => x.id === it.id);
          const xa = x0(f) + NODE_W, xb = x0(k), yb = yOf(i + 1) + (ROW_H - 6) / 2;
          let d, stub = false;
          if (j >= 0) {
            const ya = yOf(j + 1) + (ROW_H - 6) / 2, mx = (xa + xb) / 2;
            d = `M${xa},${ya} C${mx},${ya} ${mx},${yb} ${xb},${yb}`;
          } else if (keys.indexOf(f) === keys.indexOf(k) - 1) {
            d = `M${xb - 34},${TOP + ROWS * ROW_H + 4} C${xb - 18},${TOP + ROWS * ROW_H} ${xb - 18},${yb} ${xb},${yb}`;
            stub = true;
          } else return;
          const p = s("path", { class: `flow-link${ctxIds.has(it.id) ? " ctx" : ""}${fresh ? " draw" : ""}`, d, "data-id": it.id,
            "stroke-dasharray": stub ? "3 4" : null });
          linksG.append(p);
          if (fresh && !stub) {
            const len = Math.ceil(p.getTotalLength?.() || 400);
            p.style.setProperty("--len", len);
            p.style.animationDelay = `${120 + i * 30}ms`;
          }
        });
      }
    });
    this.svg = svg;
    this.container.replaceChildren(svg);
    if (!Object.keys(this.cols).length) {
      this.container.append(h("div", { class: "empty small" }, t("Lanza una pregunta para ver cómo se mueven los candidatos entre etapas.")));
    }
  }

  hover(svg, id, ev) {
    if (id == null) {
      svg.classList.remove("hovering");
      svg.querySelectorAll(".on").forEach((el) => el.classList.remove("on"));
      hideTip();
      return;
    }
    svg.classList.add("hovering");
    svg.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.add("on"));
    const ranks = this.order.filter((k) => this.cols[k]).map((k) => {
      const r = this.rankIn(k, id);
      return `${label(k)}: <b>${r ? `#${r}` : "—"}</b>`;
    }).join(" · ");
    showTip(chunkTip(this.chunks[id], ranks), ev);
  }
}
