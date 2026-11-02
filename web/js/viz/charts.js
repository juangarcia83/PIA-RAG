// Gráficos SVG ligeros con el mismo lenguaje visual que el resto de la interfaz.
import { s, h, esc, bindTip, fmtNum } from "../ui.js";

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** Barras horizontales: [{label, value, color, tip}] */
export function barsH(data, { width = 560, fmt = fmtNum, max, labelW = 190, barH = 20, gap = 8, color = "var(--accent)" } = {}) {
  const m = max ?? Math.max(...data.map((d) => d.value), 0);
  const height = data.length * (barH + gap);
  const plotW = width - labelW - 56;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });
  data.forEach((d, i) => {
    const y = i * (barH + gap);
    const w = m ? Math.max(2, (d.value / m) * plotW) : 2;
    const g = s("g", {},
      s("text", { class: "lbl", x: labelW - 10, y: y + barH / 2 + 4, "text-anchor": "end" }, d.label.length > 30 ? d.label.slice(0, 29) + "…" : d.label),
      s("rect", { x: labelW, y, width: w, height: barH, rx: 4, fill: d.color || color, opacity: 0.88 }),
      s("text", { class: "val", x: labelW + w + 6, y: y + barH / 2 + 4 }, fmt(d.value)),
    );
    bindTip(g, d.tip || `<b>${esc(d.label)}</b><br>${esc(fmt(d.value))}`);
    svg.append(g);
  });
  return svg;
}

/** Columnas agrupadas: categories × series. data[series][category] */
export function grouped(categories, series, { width = 640, height = 260, fmt = (v) => v.toFixed(2), max = 1, yTicks = [0, 0.25, 0.5, 0.75, 1], tickFmt } = {}) {
  const left = 38, bottom = 28, top = 14;
  const plotW = width - left - 8, plotH = height - bottom - top;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });
  const grid = s("g", { class: "grid" });
  for (const t of yTicks) {
    const y = top + plotH - (t / max) * plotH;
    grid.append(s("line", { x1: left, x2: width - 8, y1: y, y2: y }));
    svg.append(s("text", { x: left - 6, y: y + 4, "text-anchor": "end" }, tickFmt ? tickFmt(t) : t));
  }
  svg.prepend(grid);
  const groupW = plotW / categories.length;
  const barW = Math.min(26, (groupW - 16) / series.length);
  categories.forEach((cat, ci) => {
    const gx = left + ci * groupW + (groupW - barW * series.length) / 2;
    series.forEach((se, si) => {
      const v = se.values[ci] ?? 0;
      const hgt = (v / max) * plotH;
      const r = s("rect", { x: gx + si * barW + 1, y: top + plotH - hgt, width: barW - 2, height: Math.max(0, hgt), rx: 4, fill: se.color });
      r.style.transformOrigin = `0 ${top + plotH}px`;
      r.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 600, delay: ci * 60 + si * 30, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
      bindTip(r, `<b>${esc(se.name)}</b> · ${esc(cat)}<br>${esc(fmt(v))}`);
      svg.append(r);
    });
    svg.append(s("text", { class: "lbl", x: left + ci * groupW + groupW / 2, y: height - 8, "text-anchor": "middle" }, cat));
  });
  return svg;
}

/** Histogramas superpuestos: [{name, values, color}] */
export function histogram(series, { width = 640, height = 220, bin = 100, maxX } = {}) {
  const all = series.flatMap((x) => x.values);
  const hi = maxX ?? Math.min(Math.max(...all), quantile(all, 0.995) * 1.05);
  const nb = Math.max(5, Math.ceil(hi / bin));
  const counts = series.map((se) => {
    const c = new Array(nb).fill(0);
    se.values.forEach((v) => { c[Math.min(nb - 1, Math.floor(v / bin))] += 1; });
    return c;
  });
  const m = niceMax(Math.max(...counts.flat()));
  const left = 40, bottom = 30, top = 10, plotW = width - left - 10, plotH = height - top - bottom;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });
  const grid = s("g", { class: "grid" });
  for (let t = 0; t <= 4; t++) {
    const y = top + plotH - (t / 4) * plotH;
    grid.append(s("line", { x1: left, x2: width - 10, y1: y, y2: y }));
    svg.append(s("text", { x: left - 6, y: y + 4, "text-anchor": "end" }, Math.round((m * t) / 4)));
  }
  svg.append(grid);
  const bw = plotW / nb;
  series.forEach((se, si) => {
    let d = `M${left},${top + plotH}`;
    counts[si].forEach((c, i) => {
      const y = top + plotH - (c / m) * plotH;
      d += ` L${left + i * bw},${y} L${left + (i + 1) * bw},${y}`;
    });
    d += ` L${left + nb * bw},${top + plotH} Z`;
    svg.append(s("path", { d, fill: se.color, "fill-opacity": 0.16, stroke: se.color, "stroke-width": 1.6 }));
  });
  for (let i = 0; i <= nb; i += Math.ceil(nb / 8)) {
    svg.append(s("text", { x: left + i * bw, y: height - 10, "text-anchor": "middle" }, fmtNum(i * bin)));
  }
  return svg;
}

/** Dispersión: [{x, y, r, color, ring, tip}] */
export function scatter(points, { width = 520, height = 340, xLabel = "", yLabel = "", xMax, yMax } = {}) {
  const left = 46, bottom = 40, top = 12, right = 12;
  const plotW = width - left - right, plotH = height - top - bottom;
  const mx = xMax ?? niceMax(Math.max(...points.map((p) => p.x), 0.01));
  const my = yMax ?? niceMax(Math.max(...points.map((p) => p.y), 0.01));
  const X = (v) => left + (v / mx) * plotW, Y = (v) => top + plotH - (v / my) * plotH;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });
  const grid = s("g", { class: "grid" });
  for (let t = 0; t <= 4; t++) {
    grid.append(s("line", { x1: left, x2: width - right, y1: Y((my * t) / 4), y2: Y((my * t) / 4) }));
    grid.append(s("line", { y1: top, y2: top + plotH, x1: X((mx * t) / 4), x2: X((mx * t) / 4) }));
    svg.append(s("text", { x: left - 6, y: Y((my * t) / 4) + 4, "text-anchor": "end" }, +((my * t) / 4).toFixed(2)));
    svg.append(s("text", { x: X((mx * t) / 4), y: top + plotH + 16, "text-anchor": "middle" }, +((mx * t) / 4).toFixed(2)));
  }
  svg.append(grid,
    s("text", { class: "lbl", x: left + plotW / 2, y: height - 4, "text-anchor": "middle" }, xLabel),
    s("text", { class: "lbl", x: 12, y: top + plotH / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${top + plotH / 2})` }, yLabel));
  points.sort((a, b) => (a.ring ? 1 : 0) - (b.ring ? 1 : 0)).forEach((p, i) => {
    const c = s("circle", { cx: X(p.x), cy: Y(p.y), r: p.r || 6, fill: p.color, "fill-opacity": p.ring ? 0.9 : 0.45,
      stroke: p.ring ? "var(--ink)" : "var(--surface)", "stroke-width": p.ring ? 2 : 1.5 });
    c.animate([{ opacity: 0, transform: "scale(.4)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: i * 12, fill: "both", easing: "ease-out" });
    c.style.transformOrigin = `${X(p.x)}px ${Y(p.y)}px`;
    if (p.tip) bindTip(c, p.tip);
    svg.append(c);
  });
  return svg;
}

export function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo);
}

export function legend(items) {
  return h("div", { class: "legend" }, items.map(([label, color]) => h("span", {}, h("i", { style: { background: color } }), label)));
}

/** Escala divergente para el vector de embedding. */
export function diverging(v, max) {
  const t = Math.max(-1, Math.min(1, v / max));
  return t >= 0 ? `color-mix(in srgb, var(--c-advanced) ${Math.round(t * 100)}%, var(--sunken))`
    : `color-mix(in srgb, var(--c-naive) ${Math.round(-t * 100)}%, var(--sunken))`;
}
