// Mapa semántico: proyección PCA de todos los chunks de un índice, en canvas (miles de puntos fluidos).
import { t } from "../i18n.js";
import { showTip, hideTip, esc, short } from "../ui.js";

export const CAT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#d99400", "#e87ba4", "#4a3aa7", "#008f8c", "#e34948"];

export class SemanticMap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.view = { k: 1, x: 0, y: 0 };
    this.hidden = new Set();
    this.query = null;
    this.hover = -1;
    this.bind();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(d) {
    this.d = d;
    const xs = d.x, ys = d.y;
    this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    this.view = { k: 1, x: 0, y: 0 };
    this.draw();
  }

  /** query: {xy:[x,y], ids:[chunk ids recuperados], color, label} */
  setQuery(q) { this.query = q; this.draw(); }

  colorOf(cat) { return cat < CAT_COLORS.length - 1 ? CAT_COLORS[cat] : "#9a9a9f"; }

  toScreen(x, y) {
    const { width, height } = this.cv.getBoundingClientRect();
    const b = this.bounds, pad = 30;
    const sx = (width - 2 * pad) / (b.x1 - b.x0 || 1), sy = (height - 2 * pad) / (b.y1 - b.y0 || 1);
    const sc = Math.min(sx, sy);
    const cx = width / 2 + ((x - (b.x0 + b.x1) / 2) * sc), cy = height / 2 - ((y - (b.y0 + b.y1) / 2) * sc);
    return [(cx - width / 2) * this.view.k + width / 2 + this.view.x, (cy - height / 2) * this.view.k + height / 2 + this.view.y];
  }

  draw() {
    const cv = this.cv, ctx = this.ctx;
    const { width, height } = cv.getBoundingClientRect();
    if (!width) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(width * dpr)) { cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.d) return;
    const d = this.d, q = this.query;
    const r = Math.max(2, Math.min(5, 2.2 * Math.sqrt(this.view.k)));
    const sel = new Set(q?.ids || []);
    this.screen = new Float32Array(d.x.length * 2);
    ctx.globalAlpha = q ? 0.28 : 0.75;
    for (let i = 0; i < d.x.length; i++) {
      const [sx, sy] = this.toScreen(d.x[i], d.y[i]);
      this.screen[2 * i] = sx; this.screen[2 * i + 1] = sy;
      if (this.hidden.has(d.cat[i])) continue;
      ctx.fillStyle = this.colorOf(d.cat[i]);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#000";
    const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
    if (q?.xy) {
      const [qx, qy] = this.toScreen(q.xy[0], q.xy[1]);
      ctx.strokeStyle = q.color || ink; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7;
      for (const id of sel) { ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(this.screen[2 * id], this.screen[2 * id + 1]); ctx.stroke(); }
      ctx.globalAlpha = 1;
      for (const id of sel) {
        ctx.fillStyle = this.colorOf(d.cat[id]); ctx.strokeStyle = ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.screen[2 * id], this.screen[2 * id + 1], r + 4, 0, 6.283); ctx.fill(); ctx.stroke();
      }
      this.star(qx, qy, 11, q.color || ink, surface);
      ctx.font = "600 12px -apple-system, Segoe UI, sans-serif"; ctx.fillStyle = ink; ctx.textAlign = "center";
      ctx.fillText(q.label || t("consulta"), qx, qy - 16);
    }
    if (this.hover >= 0) {
      const i = this.hover;
      ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.screen[2 * i], this.screen[2 * i + 1], r + 4, 0, 6.283); ctx.stroke();
    }
  }

  star(x, y, R, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? R * 0.45 : R, a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }

  nearest(mx, my) {
    if (!this.screen) return -1;
    let best = -1, bd = 144;
    for (let i = 0; i < this.d.x.length; i++) {
      if (this.hidden.has(this.d.cat[i])) continue;
      const dx = this.screen[2 * i] - mx, dy = this.screen[2 * i + 1] - my, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }

  bind() {
    const cv = this.cv;
    let drag = null;
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
      const f = Math.exp(-e.deltaY * 0.0015), k = Math.max(0.6, Math.min(40, this.view.k * f)), ff = k / this.view.k;
      this.view.x = mx - (mx - this.view.x) * ff; this.view.y = my - (my - this.view.y) * ff; this.view.k = k;
      this.draw();
    }, { passive: false });
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointerup", () => { drag = null; });
    cv.addEventListener("pointermove", (e) => {
      if (drag) { this.view.x = drag.vx + e.clientX - drag.x; this.view.y = drag.vy + e.clientY - drag.y; this.draw(); hideTip(); return; }
      const rect = cv.getBoundingClientRect();
      const i = this.nearest(e.clientX - rect.left, e.clientY - rect.top);
      if (i !== this.hover) { this.hover = i; this.draw(); }
      if (i >= 0) {
        const d = this.d;
        showTip(`<b>${esc(d.code[i])}</b> <span class="t-muted">· ${esc(short(d.cats[d.cat[i]], 40))}</span><br>${esc(d.title[i])}` +
          (d.section[i] ? `<br><i class="t-muted">${esc(d.section[i])}</i>` : ""), e);
      } else hideTip();
    });
    cv.addEventListener("pointerleave", () => { this.hover = -1; hideTip(); this.draw(); });
    cv.addEventListener("dblclick", () => { this.view = { k: 1, x: 0, y: 0 }; this.draw(); });
  }
}
