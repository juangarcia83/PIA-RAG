// Corpus: qué hay indexado, cómo se reparte y cómo se trocea.
import { cached } from "../api.js";
import { h, hero, fmtNum, fmtDate, short, esc, PIPES, bindTip } from "../ui.js";
import { t } from "../i18n.js";
import { barsH, histogram, legend, quantile } from "../viz/charts.js";
import { openDoc } from "./docsheet.js";

export function corpusView(root, state) {
  const st = state.status;
  root.append(
    hero(3, "Corpus", "El *corpus*",
      t("{n} disposiciones del DOGV indexadas dos veces: una por cada estrategia de chunking.", { n: fmtNum(st.corpus.docs) })),
    h("div", { class: "empty" }, h("span", { class: "spinner" })));
  cached("/api/corpus").then((c) => paint(root, c, st));
}

function paint(root, c, st) {
  root.lastChild.remove();
  const docs = c.docs;
  const count = (k) => Object.entries(docs.reduce((m, d) => { const v = d[k] || t("(sin dato)"); m[v] = (m[v] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]);
  const idx = st.indexes;
  const stat = (v, k, sub) => h("div", { class: "card stat" }, h("span", { class: "v" }, v), h("span", { class: "k" }, k), sub ? h("span", { class: "tiny muted" }, sub) : null);
  const trimmed = c.stats.chars_raw ? 1 - c.stats.chars_trimmed / c.stats.chars_raw : 0;

  const byDate = count("date").sort((a, b) => a[0].localeCompare(b[0]));
  const maxD = Math.max(...byDate.map((x) => x[1]));
  const dateChart = h("div", { style: { display: "flex", alignItems: "flex-end", gap: "10px", height: "150px", paddingTop: "10px" } },
    byDate.map(([d, n]) => bindTip(h("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", height: "100%", justifyContent: "flex-end" } },
      h("span", { class: "tiny mono" }, n),
      h("div", { style: { width: "100%", maxWidth: "56px", height: `${(n / maxD) * 100}%`, background: "var(--brand-grad)", borderRadius: "6px 6px 2px 2px" } }),
      h("span", { class: "tiny muted" }, fmtDate(d).slice(0, 5))), `<b>${fmtDate(d)}</b><br>${t("{n} disposiciones", { n })}`)));

  const lens = Object.fromEntries(Object.entries(c.chunk_lengths).map(([k, v]) => [k, { med: quantile(v, 0.5), p95: quantile(v, 0.95) }]));

  // tabla filtrable
  const q = h("input", { class: "input", placeholder: t("Buscar por título, código u organismo…"), style: { maxWidth: "380px" } });
  const secSel = h("select", { class: "input", style: { maxWidth: "260px" } }, h("option", { value: "" }, t("Todas las secciones")),
    count("seccion").map(([s]) => h("option", { value: s }, short(s, 50))));
  const tbody = h("tbody");
  const info = h("span", { class: "small muted" });
  const fold = (x) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const render = () => {
    const needle = fold(q.value.trim());
    const rows = docs.filter((d) => (!secSel.value || d.seccion === secSel.value) &&
      (!needle || fold(`${d.title} ${d.code} ${d.organismo}`).includes(needle)));
    info.textContent = t("{n} de {total}", { n: rows.length, total: docs.length });
    tbody.replaceChildren(...rows.slice(0, 300).map((d) => h("tr", { onclick: () => openDoc(d.id) },
      h("td", { class: "mono nowrap" }, d.code), h("td", { class: "nowrap" }, fmtDate(d.date)),
      h("td", { translate: "no" }, h("div", {}, short(d.title, 150)), h("div", { class: "tiny muted" }, d.organismo)),
      h("td", { class: "small" }, short(d.seccion, 30)),
      h("td", { class: "num" }, fmtNum(d.chars)),
      h("td", { class: "num", style: { color: PIPES.naive.color } }, d.chunks.naive),
      h("td", { class: "num", style: { color: PIPES.advanced.color } }, d.chunks.advanced))));
  };
  q.addEventListener("input", render);
  secSel.addEventListener("change", render);
  render();

  root.append(
    h("div", { class: "grid g4" },
      stat(fmtNum(docs.length), t("disposiciones"), `${Object.entries(c.stats.by_lang).map(([k, v]) => `${v} ${k}`).join(" · ")}`),
      stat(fmtNum(idx.naive.chunks), "chunks naive", t("mediana {n} car.", { n: fmtNum(Math.round(lens.naive.med)) })),
      stat(fmtNum(idx.advanced.chunks), "chunks advanced", t("mediana {n} car.", { n: fmtNum(Math.round(lens.advanced.med)) })),
      stat(`${Math.round(trimmed * 100)}%`, t("texto vecino recortado"), Object.entries(c.stats.trim).map(([k, v]) => `${k}: ${v}`).join(" · "))),
    h("div", { class: "grid g2", style: { marginTop: "16px" } },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, t("Por sección"))),
        barsH(count("seccion").slice(0, 8).map(([l, v]) => ({ label: l, value: v })), { labelW: 230, width: 560 })),
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, t("Organismos con más disposiciones"))),
        barsH(count("organismo").slice(0, 8).map(([l, v]) => ({ label: l, value: v, tip: `<b>${esc(l)}</b><br>${t("{n} disposiciones", { n: v })}` })), { labelW: 230, width: 560 }))),
    h("div", { class: "grid g2", style: { marginTop: "16px" } },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Por número del DOGV")), h("div", { class: "sub" }, t("Fecha de publicación")))), dateChart),
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h3", {}, t("Tamaño de los chunks")),
        h("div", { class: "sub" }, t("En caracteres. El chunker fijo corta siempre cerca de 1.200; el estructural varía con artículos y apartados")))),
        histogram([{ name: "naive", values: c.chunk_lengths.naive, color: PIPES.naive.hex }, { name: "advanced", values: c.chunk_lengths.advanced, color: PIPES.advanced.hex }], { bin: 100 }),
        legend([[`naive · p95 ${fmtNum(Math.round(lens.naive.p95))}`, PIPES.naive.color], [`advanced · p95 ${fmtNum(Math.round(lens.advanced.p95))}`, PIPES.advanced.color]]))),
    h("div", { class: "section-title" }, h("h2", {}, t("Disposiciones")), info),
    h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" } }, q, secSel),
    h("div", { class: "table-wrap", style: { maxHeight: "640px", overflowY: "auto" } }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, ["Código", "Fecha", "Título", "Sección", "Caracteres", "Naive", "Adv."].map((x, i) => h("th", { class: i >= 4 ? "num" : "" }, t(x))))),
      tbody)),
    h("p", { class: "small muted", style: { marginTop: "10px" } }, t("Pulsa una fila para ver la disposición completa y cómo la trocea cada chunker.") + " ",
      t("Fuente: {root} (variante «{variant}»).", { root: st.corpus.root, variant: st.corpus.variant })),
  );
}
