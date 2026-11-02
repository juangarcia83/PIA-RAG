// Mapa semántico: todo el índice proyectado en 2D; se puede lanzar una consulta y ver qué recupera.
import { cached, streamRun } from "../api.js";
import { h, hero, icon, seg, fmtNum, short, PIPES, PIPE_ORDER, toast } from "../ui.js";
import { t } from "../i18n.js";
import { SemanticMap, CAT_COLORS } from "../viz/map.js";

export function mapView(root, state) {
  const st = state.status;
  let pipeline = state.lastRun?.pipeline || "advanced";
  const canvas = h("canvas");
  const map = new SemanticMap(canvas);
  const legendBox = h("div", { class: "chips", style: { marginTop: "12px" } });
  const info = h("p", { class: "small muted" });
  const q = h("input", { class: "input", placeholder: t("Proyecta una consulta sobre el mapa…"), style: { flex: 1, minWidth: "220px" } });
  const result = h("div", { class: "small", style: { marginTop: "12px" } });
  let loadedIndex = null;

  async function load() {
    const index = st.info[pipeline].index;
    if (loadedIndex === index) return;
    loadedIndex = index;
    info.textContent = t("Cargando…");
    const d = await cached(`/api/map/${index}`);
    map.setData(d);
    map.hidden.clear();
    info.textContent = t("{n} chunks del índice «{index}». PCA a 2 dimensiones: conserva el {pct}% de la varianza, así que la cercanía es orientativa (dos puntos alejados en el mapa pueden estar cerca en {dim} dimensiones).", { n: fmtNum(d.n), index, pct: Math.round(d.explained * 100), dim: st.models.dim });
    legendBox.replaceChildren(...d.cats.slice(0, CAT_COLORS.length).map((c, i) => {
      const b = h("button", { class: "chip active", onclick: () => {
        map.hidden.has(i) ? map.hidden.delete(i) : map.hidden.add(i);
        b.classList.toggle("active", !map.hidden.has(i));
        map.draw();
      } }, h("span", { class: "dot", style: { background: map.colorOf(i) } }), i < CAT_COLORS.length - 1 ? short(c, 40) : t("otras secciones"));
      return b;
    }));
  }

  async function project() {
    const text = q.value.trim();
    if (!text) return;
    result.replaceChildren(h("span", { class: "spinner" }), " " + t("Buscando…"));
    let res = null;
    try {
      await streamRun({ question: text, pipeline, generate: false }, (ev) => { if (ev.type === "result") res = ev; });
    } catch (e) { toast(e.message); return; }
    if (!res) return;
    await load();
    map.setQuery({ xy: res.query_xy, ids: res.contexts.flatMap((c) => c.chunk_ids), color: PIPES[pipeline].hex });
    result.replaceChildren(h("b", {}, t("{name} recupera:", { name: t(PIPES[pipeline].label) })), h("ol", { translate: "no", style: { margin: "6px 0 0", paddingLeft: "1.3em" } },
      res.contexts.map((c) => h("li", {}, h("span", { class: "mono" }, c.code), " ", short(c.title, 110)))));
  }
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") project(); });

  root.append(
    hero(4, "Mapa semántico", "Mapa *semántico*",
      t("Cada punto es un chunk. Lo que está cerca habla de lo mismo; la estrella es tu consulta.")),
    h("div", { class: "card" },
      h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" } },
        seg(PIPE_ORDER.map((p) => [p, t(PIPES[p].label)]), pipeline, (v) => { pipeline = v; load(); }, { colors: Object.fromEntries(PIPE_ORDER.map((p) => [p, PIPES[p].color])) }),
        q, h("button", { class: "btn", onclick: project }, icon("search"), t("Proyectar"))),
      info,
      h("div", { class: "map-wrap" }, canvas),
      legendBox, result,
      h("p", { class: "tiny muted" }, t("Rueda: zoom · arrastrar: mover · doble clic: centrar · pulsa una sección para ocultarla."))),
  );
  load().then(() => {
    const lr = state.lastRun;
    if (lr?.result?.query_xy && st.info[lr.pipeline].index === loadedIndex) {
      map.setQuery({ xy: lr.result.query_xy, ids: lr.result.contexts.flatMap((c) => c.chunk_ids), color: PIPES[lr.pipeline].hex, label: short(lr.question, 40) });
      q.value = lr.question;
    }
  });
}
