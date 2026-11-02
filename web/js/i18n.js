// Idioma de la interfaz: castellano (base) o valenciano.
//
// Cada texto se escribe en castellano y se pasa por t(): en valenciano se busca en VA y, si falta, se deja en
// castellano (y se avisa en la consola). Los textos con datos usan marcadores: t("Listo en {ms}", { ms }).
// El contenido del corpus y las respuestas del LLM no se traducen.
import { VA } from "./i18n-va.js";

const KEY = "raglab.lang";
let lang = "es";
try {
  lang = localStorage.getItem(KEY) || (/^(ca|va)/i.test(navigator.language) ? "va" : "es");
} catch {}
document.documentElement.lang = lang === "va" ? "ca-ES-valencia" : "es";

export const getLang = () => lang;

export function setLang(next) {
  lang = next === "va" ? "va" : "es";
  try { localStorage.setItem(KEY, lang); } catch {}
  document.documentElement.lang = lang === "va" ? "ca-ES-valencia" : "es";
  dispatchEvent(new Event("langchange"));
}

const missing = new Set();

export function t(es, vars) {
  let s = es;
  if (lang === "va") {
    if (VA[es] !== undefined) s = VA[es];
    else if (!missing.has(es)) { missing.add(es); console.warn("[i18n] sin traducción al valenciano:", es); }
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
}
