// Idioma de la interfaz: valenciano.
//
// Cada texto se escribe en castellano y se pasa por t(), que lo busca en VA; si falta, se deja en castellano (y se
// avisa en la consola). Los textos con datos usan marcadores: t("Listo en {ms}", { ms }).
// El contenido del corpus y las respuestas del LLM no se traducen.
import { VA } from "./i18n-va.js";

document.documentElement.lang = "ca-ES-valencia";

const missing = new Set();

export function t(es, vars) {
  let s = es;
  if (VA[es] !== undefined) s = VA[es];
  else if (!missing.has(es)) { missing.add(es); console.warn("[i18n] sin traducción al valenciano:", es); }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
}
