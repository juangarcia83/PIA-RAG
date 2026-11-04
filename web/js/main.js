// Arranque: pantalla de carga, navegación por hash, tema y conexión con el LLM.
import { getJSON, postJSON } from "./api.js";
import { $, $$, h, icon, openLayer, toast, esc } from "./ui.js";
import { t } from "./i18n.js";
import { startMotion, moveTabInk } from "./motion.js";
import { askView } from "./views/ask.js";
import { compareView } from "./views/compare.js";
import { corpusView } from "./views/corpus.js";
import { mapView } from "./views/map.js";
import { evalView } from "./views/eval.js";
import { guideView } from "./views/guide.js";
import { learnView } from "./views/learn.js";

export const state = { status: null, lastRun: null };

const ROUTES = { ask: askView, compare: compareView, corpus: corpusView, map: mapView, eval: evalView, guide: guideView, learn: learnView };
let current = null;

const TITLES = { ask: "Preguntar", compare: "Comparar", corpus: "Corpus", map: "Mapa semántico", eval: "Evaluación",
  guide: "Cómo funciona", learn: "Arquitecturas" };

function route({ keepScroll = false, focus = false } = {}) {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || "ask";
  const view = ROUTES[name] ? name : "ask";
  $$(".tab").forEach((tab) => (tab.dataset.route === view ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current")));
  document.title = `${t(TITLES[view])} · RAG Lab · DOGV`;
  $("#menu-current").textContent = t(TITLES[view]);
  setMenu(false);
  moveTabInk();
  if (current?.destroy) current.destroy();
  const y = scrollY;
  const app = $("#app");
  app.replaceChildren();
  const root = h("div", { class: "view" });
  app.append(root);
  current = ROUTES[view](root, state, { restore: keepScroll }) || null;
  scrollTo({ top: keepScroll ? y : 0 });
  // al cambiar de sección, el foco va al título para que el lector de pantalla anuncie la página nueva
  if (focus) {
    const h1 = root.querySelector("h1");
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => { location.hash = `#/${tab.dataset.route}`; }));
addEventListener("hashchange", () => route({ focus: true }));
// menú de secciones en móvil y tablet (en pantallas anchas las pestañas se ven siempre y el botón no aparece)
function setMenu(open) {
  $(".nav").classList.toggle("menu-open", open);
  $("#menu-btn").setAttribute("aria-expanded", open);
}
$("#menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !$(".nav").classList.contains("menu-open");
  setMenu(open);
  if (open) $('.tab[aria-current="page"]')?.focus();
});
document.addEventListener("click", (e) => { if (!$("#sections").contains(e.target)) setMenu(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $(".nav").classList.contains("menu-open")) { setMenu(false); $("#menu-btn").focus(); }
});
// «Saltar al contenido»: la app enruta por el hash, así que el enlace no puede cambiarlo
$(".skip-link").addEventListener("click", (e) => { e.preventDefault(); $("#app").focus(); });

// ------------------------------------------------------------------ textos fijos
/** Textos fijos de index.html: cada elemento con data-i18n guarda su texto en castellano como clave. */
function applyStaticTexts() {
  $$("[data-i18n]").forEach((el) => {
    el.dataset.i18n ||= el.textContent;
    el.textContent = t(el.dataset.i18n);
  });
  $$("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
  $$("[data-i18n-alt]").forEach((el) => el.setAttribute("alt", t(el.dataset.i18nAlt)));
}
applyStaticTexts();

// ------------------------------------------------------------------ tema
const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
function applyThemeIcon() {
  const btn = $("#theme-btn");
  btn.replaceChildren(icon(isDark() ? "sun" : "moon"));
  btn.setAttribute("aria-label", isDark() ? t("Cambiar a tema claro") : t("Cambiar a tema oscuro"));
  // la barra del navegador del móvil toma el color de fondo del tema
  $("#theme-color").setAttribute("content", getComputedStyle(document.body).backgroundColor);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyThemeIcon());
$("#theme-btn").addEventListener("click", () => {
  document.documentElement.dataset.theme = isDark() ? "light" : "dark";
  try { localStorage.setItem("raglab.theme", document.documentElement.dataset.theme); } catch {}
  applyThemeIcon();
  dispatchEvent(new Event("themechange"));
});
applyThemeIcon();

// ------------------------------------------------------------------ LLM
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function renderLLMPill() {
  const llm = state.status?.llm;
  const pill = $("#llm-pill");
  pill.replaceChildren(
    h("span", { class: `dot ${llm?.available ? "on" : "off"}` }),
    h("span", {}, llm?.available ? short(llm.model || "LLM", 28) : t("Solo retrieval")),
  );
  pill.title = llm?.available ? t("Conectado: {name}", { name: llm.name }) : t("Sin LLM: {error}", { error: llm?.error || "" });
  pill.setAttribute("aria-label", `${pill.title}. ${t("Configurar el modelo generativo")}`);
}

function llmDialog() {
  const llm = state.status?.llm || {};
  // sin conexión, los campos parten de la configuración del proyecto (la misma que el notebook)
  const def = state.status?.llm_defaults || {};
  const presets = {
    DeepSeek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", api_key_env: "DEEPSEEK_API_KEY" },
    "LM Studio": { base_url: "http://localhost:1234/v1", model: "", api_key_env: "" },
    Ollama: { base_url: "http://localhost:11434/v1", model: "", api_key_env: "" },
  };
  const f = {
    base: h("input", { class: "input", value: llm.base_url || def.base_url || "", placeholder: "https://api.deepseek.com" }),
    model: h("input", { class: "input", value: llm.model || def.model || "", placeholder: t("vacío = primer modelo del servidor") }),
    key: h("input", { class: "input", type: "password", placeholder: t("opcional · se guarda solo en memoria del servidor"), autocomplete: "off" }),
    env: h("input", { class: "input", value: def.api_key_env || "DEEPSEEK_API_KEY", placeholder: t("nombre de la variable de entorno") }),
  };
  const status = h("div", { class: "small", style: { marginTop: "4px" } });
  const paint = (l) => {
    status.replaceChildren(h("span", { class: `badge ${l.available ? "good" : "warn"}` }, l.available ? t("Conectado") : t("Sin conexión")),
      " ", h("span", { class: "muted" }, l.available ? l.name : l.error || t("Modo solo retrieval: se muestran los fragmentos recuperados.")));
  };
  paint(llm);
  const btn = h("button", { class: "btn", onclick: async () => {
    btn.disabled = true;
    btn.replaceChildren(h("span", { class: "spinner" }), t("Conectando…"));
    try {
      const res = await postJSON("/api/llm", { base_url: f.base.value, model: f.model.value, api_key: f.key.value || null,
        api_key_env: f.env.value || null, extra_body: /deepseek/.test(f.base.value) ? { thinking: { type: "disabled" } } : null });
      state.status.llm = res;
      paint(res);
      renderLLMPill();
      toast(res.available ? t("LLM conectado") : t("No se pudo conectar"));
    } catch (e) { toast(e.message); }
    btn.disabled = false;
    btn.replaceChildren(t("Conectar"));
  } }, t("Conectar"));
  const content = h("div", {},
    h("div", { class: "eyebrow" }, t("Ajustes")),
    h("h3", { style: { font: "560 24px var(--font-display)", margin: "4px 0 6px", letterSpacing: "-.015em" } }, t("Modelo generativo")),
    h("p", { class: "muted small", style: { marginTop: 0 } }, t("Cualquier servidor con API tipo OpenAI. Sin LLM el laboratorio funciona en modo solo retrieval: Corrective no puede reformular y no se generan respuestas.")),
    h("div", { class: "chips", style: { margin: "12px 0 16px" } }, Object.entries(presets).map(([name, p]) =>
      h("button", { class: "chip", onclick: () => { f.base.value = p.base_url; f.model.value = p.model; f.env.value = p.api_key_env; } }, name))),
    h("div", { class: "grid", style: { gap: "12px" } },
      h("div", { class: "field" }, h("label", {}, t("URL base")), f.base),
      h("div", { class: "field" }, h("label", {}, t("Modelo")), f.model),
      h("div", { class: "grid g2", style: { gap: "12px" } },
        h("div", { class: "field" }, h("label", {}, t("Variable de entorno con la clave")), f.env),
        h("div", { class: "field" }, h("label", {}, t("o clave directa")), f.key)),
      status),
    h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "20px" } },
      h("button", { class: "btn secondary", onclick: () => layer.close() }, t("Cerrar")), btn),
  );
  const layer = openLayer("modal", content);
}
$("#llm-pill").addEventListener("click", llmDialog);

// ------------------------------------------------------------------ carga inicial
async function boot() {
  const loader = $("#loader");
  for (;;) {
    try {
      const st = await getJSON("/api/status");
      state.status = st;
      $("#loader-msg").textContent = st.status.error || st.status.message;
      $("#loader-bar").style.width = `${Math.max(2, st.status.progress * 100)}%`;
      $("#loader-log").innerHTML = st.log.map((l) => `<div>${esc(l.t)} · ${esc(l.msg)}</div>`).join("");
      if (st.status.ready) break;
      if (st.status.error) {
        $("#loader-msg").innerHTML = `<span class="badge bad">Error</span> ${esc(st.status.error)}<br><span class="small">${t("Revisa la consola del servidor y {file}.", { file: "<code>webapp/settings.json</code>" })}</span>`;
        return;
      }
    } catch {
      $("#loader-msg").textContent = t("Esperando al servidor…");
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  renderLLMPill();
  startMotion($("#app"));
  route();
  loader.classList.add("done");
  setTimeout(() => loader.remove(), 600);
}
boot();
