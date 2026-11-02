// Hoja lateral con una disposición: metadatos, texto y cómo la trocea cada estrategia de chunking.
import { cached } from "../api.js";
import { h, icon, openLayer, seg, esc, fmtDate, fmtNum, bindTip, PIPES } from "../ui.js";
import { t } from "../i18n.js";

const CHUNKERS = { naive: "Tamaño fijo (naive)", advanced: "Estructural (advanced)" };

export async function openDoc(docId, { chunker = "advanced", focusStart = null } = {}) {
  const body = h("div", { class: "sheet-body" }, h("div", { class: "empty" }, h("span", { class: "spinner" })));
  const head = h("div", { class: "sheet-head" });
  const layer = openLayer("sheet", [head, body]);
  let doc;
  try { doc = await cached(`/api/doc/${encodeURIComponent(docId)}`); }
  catch (e) { body.replaceChildren(h("div", { class: "empty" }, e.message)); return; }

  head.replaceChildren(
    h("div", { style: { flex: 1, minWidth: 0 } },
      h("div", { class: "eyebrow" }, `${doc.code} · ${t("DOGV núm.")} ${doc.num} · ${fmtDate(doc.date)}`),
      h("h3", { translate: "no" }, doc.title || t("(sin título)")),
      h("div", { class: "small muted", style: { marginTop: "4px" } }, doc.organismo)),
    doc.url ? h("a", { class: "btn secondary sm", href: doc.url, target: "_blank", rel: "noopener" }, icon("doc"), "PDF") : null,
    h("button", { class: "icon-btn", "aria-label": t("Cerrar"), onclick: () => layer.close() }, icon("close")),
  );

  let current = chunker;
  const barWrap = h("div");
  const textBox = h("div", { class: "doc-text", translate: "no" });
  const info = h("div", { class: "small muted", style: { margin: "8px 0 12px" } });
  const headerBox = h("pre", { class: "code", translate: "no" });

  const paint = (focus) => {
    const segs = doc.segments[current] || [];
    const color = PIPES[current].color;
    barWrap.style.setProperty("--pc", color);
    textBox.style.setProperty("--pc", color);
    const total = doc.text.length || 1;
    const bar = h("div", { class: "chunkbar" });
    segs.forEach((sg, i) => {
      const span = h("span", { style: { width: `${(Math.min(sg.end, segs[i + 1]?.start ?? sg.end) - sg.start) / total * 100}%`,
        background: color, opacity: i % 2 ? 0.55 : 0.85 }, onclick: () => select(i) });
      bindTip(span, `<b>Chunk ${i + 1}</b> · ${t("{n} caracteres", { n: fmtNum(sg.len) })}${sg.section ? `<br><i class="t-muted">${esc(sg.section)}</i>` : ""}`);
      bar.append(span);
    });
    barWrap.replaceChildren(bar);
    const lens = segs.map((x) => x.len);
    const cfg = doc.config[current];
    info.textContent = t("{n} chunks · mediana {m} caracteres", { n: segs.length, m: fmtNum(lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)] || 0) }) + " · " +
      Object.entries(cfg).filter(([k]) => k !== "name").map(([k, v]) => `${k}=${v}`).join(", ");
    // texto con los límites de cada chunk (el solapamiento del chunker fijo se asigna al chunk siguiente)
    const frag = document.createDocumentFragment();
    let pos = 0;
    segs.forEach((sg, i) => {
      const start = Math.max(sg.start, pos);
      if (start > pos) frag.append(doc.text.slice(pos, start));
      const end = Math.max(start, Math.min(sg.end, segs[i + 1]?.start ?? sg.end));
      const mark = h("mark", { class: `c${i % 2}`, dataset: { i } }, h("span", { class: "boundary" }, `#${i + 1}`), doc.text.slice(start, end));
      frag.append(mark);
      pos = end;
    });
    if (pos < doc.text.length) frag.append(doc.text.slice(pos));
    textBox.replaceChildren(frag);
    const sec = segs.find((x) => x.section)?.section || "";
    headerBox.textContent = current === "advanced"
      ? `${doc.header}${sec ? `\n${doc.lang === "es" ? "Apartado" : "Apartat"}: ${sec}` : ""}\n\n${doc.text.slice(segs[0]?.start ?? 0, (segs[0]?.start ?? 0) + 220)}…`
      : `${doc.text.slice(0, 260)}…\n\n${t("(El índice naive no añade cabecera: el chunk se embebe tal cual.)")}`;
    if (focus != null) {
      const i = segs.findIndex((x) => x.start <= focus && focus < x.end);
      if (i >= 0) select(i);
    }
  };
  const select = (i) => {
    textBox.querySelectorAll("mark.sel").forEach((m) => m.classList.remove("sel"));
    barWrap.querySelectorAll("span.sel").forEach((m) => m.classList.remove("sel"));
    const m = textBox.querySelector(`mark[data-i="${i}"]`);
    barWrap.querySelector(".chunkbar").children[i]?.classList.add("sel");
    if (m) { m.classList.add("sel"); m.scrollIntoView({ block: "center", behavior: "smooth" }); }
  };

  const meta = [
    [t("Sección"), [doc.seccion, doc.subseccion].filter(Boolean).join(" › ")],
    [t("Idioma"), doc.lang === "va" ? t("Valenciano") : t("Castellano")],
    [t("Recorte a la disposición"), t({ marker: "por código de inserción", title: "por título oficial", none: "sin recorte" }[doc.trim] || doc.trim)],
    [t("Longitud"), t("{n} caracteres", { n: fmtNum(doc.text.length) })],
  ];
  body.replaceChildren(
    h("div", { class: "grid g2", style: { gap: "10px 18px", marginBottom: "18px" } },
      meta.map(([k, v]) => h("div", {}, h("div", { class: "tiny muted" }, k), h("div", { class: "small" }, v || "—")))),
    doc.title_alt ? h("div", { class: "small muted", style: { marginBottom: "16px" } }, h("b", {}, t("Título en el otro idioma:") + " "), doc.title_alt) : null,
    h("div", { class: "card-head", style: { marginBottom: "10px" } },
      h("div", {}, h("h3", {}, "Chunking"), h("div", { class: "sub" }, t("Cada segmento es un chunk; pulsa uno para localizarlo en el texto."))),
      seg(Object.entries(CHUNKERS).map(([k, v]) => [k, t(v)]), current, (v) => { current = v; paint(); }, { colors: { naive: PIPES.naive.color, advanced: PIPES.advanced.color } })),
    barWrap, info, textBox,
    h("details", { class: "disclose" }, h("summary", {}, t("Qué texto ve el retriever (cabecera contextual)")),
      h("p", { class: "small muted" }, t("El índice avanzado antepone a cada chunk una cabecera determinista con número, fecha, organismo, sección, título y apartado (contextual retrieval sin LLM). El naive embebe el fragmento sin contexto.")),
      headerBox),
  );
  paint(focusStart);
}

/** Localiza en el texto completo el inicio de un fragmento recuperado. */
export async function openDocAtText(docId, text, chunker) {
  let start = null;
  try {
    const doc = await cached(`/api/doc/${encodeURIComponent(docId)}`);
    const i = doc.text.indexOf(text.slice(0, 60));
    start = i >= 0 ? i : null;
  } catch {}
  return openDoc(docId, { chunker, focusStart: start });
}
