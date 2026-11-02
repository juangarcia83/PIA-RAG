// Constelación de la portada: los chunks reales del índice (su proyección PCA) y una consulta que recorre
// el espacio uniéndose en cada momento a sus vecinos más cercanos. Es la idea del retrieval denso, dibujada
// con el propio corpus.
const K = 6;

export class Constellation {
  constructor(canvas, data, { maxPoints = 1100 } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.alive = true;
    this.t0 = performance.now();
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // muestra determinista y normalizada a [0, 1]
    const n = data.x.length, step = Math.max(1, Math.floor(n / maxPoints));
    const idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    const xs = idx.map((i) => data.x[i]), ys = idx.map((i) => data.y[i]);
    // escala por percentiles: unos pocos chunks atípicos no deben apelotonar al resto
    const q = (a, f) => [...a].sort((u, v) => u - v)[Math.floor(f * (a.length - 1))];
    const [x0, x1, y0, y1] = [q(xs, 0.02), q(xs, 0.98), q(ys, 0.02), q(ys, 0.98)];
    const clamp = (v) => Math.max(-0.04, Math.min(1.04, v));
    this.pts = idx.map((i, j) => ({
      x: clamp((xs[j] - x0) / (x1 - x0 || 1)), y: clamp(1 - (ys[j] - y0) / (y1 - y0 || 1)),
      ph: (i * 2.399) % 6.283, cat: data.cat[i],
    }));
    // la consulta viaja entre fragmentos reales (siempre «dentro» del corpus)
    let seed = 7;
    this.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.from = this.pick();
    this.to = this.pick();
    this.legStart = 0;
    this.readColors();
    this.onTheme = () => this.readColors();
    addEventListener("themechange", this.onTheme);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", this.onTheme);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); });
    this.io.observe(canvas);
    this.loop();
  }

  pick() {
    const p = this.pts[Math.floor(this.rnd() * this.pts.length)];
    return { x: Math.min(0.94, Math.max(0.06, p.x)), y: Math.min(0.9, Math.max(0.1, p.y)) };
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k, d) => cs.getPropertyValue(k).trim() || d;
    this.col = { dot: v("--const-dot", "#6b7190"), a: v("--brand", "#1a0088"), b: v("--brand-2", "#41b8ee"), ink: v("--ink", "#0f1222") };
    if (this.still) this.frame(performance.now());
  }

  loop() {
    if (!this.alive || this.raf) return;
    const tick = (now) => {
      this.raf = null;
      if (!this.alive || !this.visible) return;
      this.frame(now);
      if (!this.still) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  frame(now) {
    const cv = this.cv, ctx = this.ctx;
    const { width: W, height: H } = cv.getBoundingClientRect();
    if (!W) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = (now - this.t0) / 1000, pad = 22;
    const P = this.pts.map((p) => [pad + (p.x + 0.006 * Math.sin(t * 0.6 + p.ph)) * (W - 2 * pad),
      pad + (p.y + 0.006 * Math.cos(t * 0.5 + p.ph)) * (H - 2 * pad)]);
    // tramo actual: 4,5 s entre dos fragmentos, con aceleración suave
    const LEG = 4.5;
    if (t - this.legStart > LEG) { this.legStart = t; this.from = this.to; this.to = this.pick(); }
    const k = Math.min(1, (t - this.legStart) / LEG), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    const qx = pad + (this.from.x + (this.to.x - this.from.x) * e) * (W - 2 * pad);
    const qy = pad + (this.from.y + (this.to.y - this.from.y) * e) * (H - 2 * pad);
    const near = P.map(([x, y], i) => [(x - qx) ** 2 + (y - qy) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, K);

    ctx.fillStyle = this.col.dot;
    ctx.globalAlpha = 0.34;
    for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;

    const g = ctx.createLinearGradient(qx - 80, qy, qx + 80, qy);
    g.addColorStop(0, this.col.a); g.addColorStop(1, this.col.b);
    near.forEach(([, i], r) => {
      const [x, y] = P[i];
      ctx.strokeStyle = g; ctx.lineWidth = 1.4 - r * 0.15; ctx.globalAlpha = 0.85 - r * 0.1;
      ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = this.col.b;
      ctx.beginPath(); ctx.arc(x, y, 3.2 - r * 0.25, 0, 6.283); ctx.fill();
    });
    // pulso de búsqueda
    const pulse = (t * 0.8) % 1;
    ctx.strokeStyle = this.col.a; ctx.globalAlpha = 0.5 * (1 - pulse); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(qx, qy, 6 + pulse * 34, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(qx, qy, 5.5, 0, 6.283); ctx.fill();
  }

  destroy() {
    this.alive = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.io.disconnect();
    removeEventListener("themechange", this.onTheme);
  }
}
