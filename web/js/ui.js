// Utilidades de interfaz: creación de nodos, formato, tooltip, toast, hojas y modales.
import { t } from "./i18n.js";

export const PIPES = {
  naive: { label: "Naive", color: "var(--c-naive)", hex: "#2a78d6" },
  hybrid: { label: "Híbrido", color: "var(--c-hybrid)", hex: "#d99400" },
  advanced: { label: "Advanced", color: "var(--c-advanced)", hex: "#eb6834" },
  corrective: { label: "Corrective", color: "var(--c-corrective)", hex: "#1baf7a" },
  agentic: { label: "Agentic", color: "var(--c-agentic)", hex: "#7b4fd6" },
};
export const PIPE_ORDER = ["naive", "hybrid", "advanced", "corrective", "agentic"];

// Como en h(), los hijos null/undefined/false se ignoran también en append y replaceChildren
// (si no, el DOM los convierte en el texto «null»).
for (const name of ["append", "replaceChildren"]) {
  const native = Element.prototype[name];
  Element.prototype[name] = function (...kids) { return native.apply(this, kids.filter((k) => k != null && k !== false)); };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Hyperscript: h("div", {class: "x", onclick: fn, style: {...}}, hijos...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs, true);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs, svg = false) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class" && !svg) el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(name, cls = "icon") {
  const paths = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
    arrow: "M5 12h14M13 6l6 6-6 6",
    up: "M12 19V5M6 11l6-6 6 6",
    play: "M7 5l12 7-12 7z",
    pause: "M8 5v14M16 5v14",
    replay: "M4 4v6h6M20 12a8 8 0 1 1-2.3-5.7L20 9",
    prev: "M15 6l-6 6 6 6",
    next: "M9 6l6 6-6 6",
    close: "M6 6l12 12M18 6L6 18",
    filter: "M4 6h16M7 12h10M10 18h4",
    sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
    doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    check: "M5 12l5 5 9-10",
    info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
    alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    chat: "M5 5h14v10H9l-4 4z",
    db: "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    vector: "M4 20L20 4M14 4h6v6",
    text: "M5 6h14M9 6v12M15 6v12M7 18h4M13 18h4",
    merge: "M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v3M18 4v5a4 4 0 0 1-4 4",
    layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
    gauge: "M4 18a8 8 0 1 1 16 0M12 18l4-6",
    pen: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    copy: "M9 9h11v11H9zM5 15V4h11",
    download: "M12 4v12M6 10l6 6 6-6M5 20h14",
    sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    dice: "M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01",
    flask: "M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3",
  };
  return s("svg", { class: cls, viewBox: "0 0 24 24", "aria-hidden": "true" }, s("path", { d: paths[name] || "" }));
}

export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);
export const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("es-ES"));
export const fmtScore = (x, d = 3) => (x == null ? "—" : Number(x).toFixed(d));
export const pct = (x, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
export const short = (t, n) => { t = String(t ?? ""); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
export const fmtDate = (iso) => (iso && iso.length === 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || "");
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ tooltip
const tip = () => document.getElementById("tip");
export function showTip(html, ev) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add("show");
  moveTip(ev);
}
export function moveTip(ev) {
  const t = tip();
  if (!ev) return;
  const pad = 14, w = t.offsetWidth, hgt = t.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + hgt > innerHeight - 8) y = ev.clientY - hgt - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
export function hideTip() { tip().classList.remove("show"); }
export function bindTip(el, htmlFn) {
  el.addEventListener("mouseenter", (e) => showTip(typeof htmlFn === "function" ? htmlFn() : htmlFn, e));
  el.addEventListener("mousemove", moveTip);
  el.addEventListener("mouseleave", hideTip);
  return el;
}

export function chunkTip(c, extra = "") {
  if (!c) return "";
  return `<b>${esc(c.code)}</b> <span class="t-muted">· ${esc(fmtDate(c.date))} · chunk ${c.idx + 1}</span><br>` +
    `${esc(short(c.title, 160))}` +
    (c.section ? `<br><i class="t-muted">${esc(short(c.section, 90))}</i>` : "") +
    (extra ? `<div style="margin-top:6px">${extra}</div>` : "") +
    `<div class="t-muted" style="margin-top:6px">${esc(short(c.text, 260))}</div>`;
}

// ------------------------------------------------------------------ toast
let toastTimer;
export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ------------------------------------------------------------------ hoja lateral y modal
export function openLayer(kind, content, { onClose } = {}) {
  const scrim = h("div", { class: "scrim" });
  const layer = h("div", { class: kind, role: "dialog", "aria-modal": "true" }, content);
  const close = () => {
    layer.classList.remove("show");
    scrim.classList.remove("show");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => { layer.remove(); scrim.remove(); }, 350);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(scrim, layer);
  requestAnimationFrame(() => { scrim.classList.add("show"); layer.classList.add("show"); });
  return { close, layer };
}

// ------------------------------------------------------------------ Markdown mínimo con citas [n]
export function renderAnswer(text) {
  const lines = String(text || "").split(/\n/);
  let html = "", list = null;
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, nums) => nums.split(/\s*,\s*/).map((n) => `<span class="cite" data-n="${n}">${n}</span>`).join(""));
  const flush = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*•]\s+(.*)/), ol = line.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) { flush(); html += `<${tag}>`; list = tag; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (!line) flush();
    else if (/^#{1,4}\s/.test(line)) { flush(); html += `<p><b>${inline(line.replace(/^#+\s*/, ""))}</b></p>`; }
    else { flush(); html += `<p>${inline(line)}</p>`; }
  }
  flush();
  return html;
}

/** Cabecera de sección con el estilo propio del laboratorio: «§ 0n · Sección», título con serifa y una
 * palabra en cursiva (entre asteriscos en `title`), entradilla y, opcionalmente, una ilustración a la derecha. */
export function hero(num, section, title, lede, art = null) {
  const parts = t(String(title)).split(/\*(.+?)\*/);
  return h("section", { class: `hero${art ? " with-art" : ""}` },
    h("div", { class: "hero-text" },
      h("div", { class: "kicker" }, h("span", { class: "sec" }, "§"), ` ${String(num).padStart(2, "0")} · ${t(section)}`),
      h("h1", {}, parts.map((p, i) => (i % 2 ? h("em", {}, p) : p))),
      lede ? h("p", {}, lede) : null),
    art);
}

export function seg(options, value, onChange, { colors } = {}) {
  const wrap = h("div", { class: "seg", role: "group" });
  const render = (v) => [...wrap.children].forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
  for (const [v, label] of options) {
    wrap.append(h("button", { type: "button", dataset: { v }, onclick: () => { render(v); onChange(v); } },
      colors?.[v] ? h("span", { class: "sw", style: { background: colors[v] } }) : null, label));
  }
  render(value);
  wrap.set = render;
  return wrap;
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(`raglab.${key}`));
    localStorage.setItem(`raglab.${key}`, JSON.stringify(value));
  } catch { return undefined; }
}

export function download(name, text, type = "text/csv") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
