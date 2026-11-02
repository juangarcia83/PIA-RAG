// Narración de cada evento del pipeline: una frase que explica qué acaba de pasar y con qué datos.
// La usan «Preguntar» (paso a paso) y la vista incrustada en Open WebUI.
import { esc, fmtMs, fmtScore, fmtNum, short, PIPES } from "./ui.js";
import { t } from "./i18n.js";

export function describe(ev, ctx) {
  const cfg = ctx.config || {};
  const P = (x) => `<b>${x}</b>`;
  switch (ev.type) {
    case "start": {
      const f = Object.entries(ev.filters || {}).map(([k, v]) => `${k}=${esc(v)}`).join(", ");
      const where = f
        ? t("Prefiltro por metadatos ({f}): quedan {n} de {total} chunks.", { f: esc(f), n: P(fmtNum(ev.filtered_chunks)), total: fmtNum(cfg.index_size) })
        : t("Se busca en los {n} chunks del índice «{index}».", { n: P(fmtNum(cfg.index_size)), index: esc(ev.config?.index) });
      return { step: t("Consulta"), html: `${t("Llega la pregunta a {name}.", { name: P(t(PIPES[ev.pipeline].label)) })} ${where}` };
    }
    case "embed":
      return ev.pass > 1 || ctx.embeds > 1
        ? { step: "Embedding", html: t("Se codifica también la consulta alternativa {q} ({ms}).", { q: P("«" + esc(short(ev.text, 90)) + "»"), ms: fmtMs(ev.ms) }) }
        : { step: "Embedding", html: t("El bi-encoder convierte la consulta en un vector de {dim} dimensiones ({ms}). Consulta y chunks viven en el mismo espacio: la cercanía es similitud semántica.", { dim: P(ev.dim), ms: fmtMs(ev.ms) }) };
    case "dense":
      return { step: t("Denso"), html: t("Similitud coseno contra todos los chunks: el mejor obtiene {s}. Encuentra paráfrasis y sinónimos, pero puede fallar con códigos, nombres propios o cifras.", { s: P(fmtScore(ev.hits[0]?.s)) }) };
    case "bm25":
      return { step: "BM25", html: t("La consulta queda en {n} términos ({tokens}). {hits} chunks contienen alguno; BM25 premia los términos raros (IDF) y penaliza los chunks largos.", {
        n: P(ev.tokens.length), tokens: ev.tokens.map((w) => `<code>${esc(w)}</code>`).join(" ") || t("ninguno"), hits: P(fmtNum(ev.n)) }) };
    case "fusion": {
      const both = ev.hits.filter((x) => x.r.filter((r) => r != null).length > 1).length;
      return { step: "RRF", html: t("Reciprocal Rank Fusion suma {formula} de {n} listas. Solo cuenta la posición, no la escala del score. {both} de los {top} primeros aparecen en más de una lista.", {
        formula: P(`1/(${ev.rrf_k} + ${t("rango")})`), n: P(ev.lists.length), both: P(both), top: ev.hits.length }) };
    }
    case "candidates": {
      const rr = cfg.reranker
        ? t(" para el reranker. Ahora el cross-encoder lee {n} pares (consulta, chunk): es la etapa más cara{cpu}…", { n: ev.n, cpu: ctx.device === "cpu" ? t(", en CPU puede tardar decenas de segundos") : "" })
        : ".";
      return { step: t("Candidatos"), html: t("Se eliminan textos duplicados y se conservan los {n} mejores candidatos", { n: P(ev.n) }) + rr };
    }
    case "rerank": {
      const top = ev.hits[0];
      const moved = ev.hits.filter((x, i) => x.prev !== i + 1).length;
      return { step: "Reranker", html: t("El cross-encoder lee cada par (consulta, chunk) completo, más caro pero más preciso: {ms}. El nuevo #1 (score {s}) venía del puesto {prev} de RRF; {moved} candidatos cambian de posición.", {
        ms: P(fmtMs(ev.ms)), s: P(fmtScore(top?.s)), prev: P("#" + (top?.prev ?? "?")), moved: P(moved) }) };
    }
    case "agent_plan": {
      const head = t("Paso {step}/{max}", { step: ev.step, max: ev.max_steps });
      const why = ev.thought ? ` <span class="muted">${t("Razonamiento:")} «${esc(short(ev.thought, 220))}»</span>` : "";
      const forced = ev.fallback ? ` <span class="muted">${t("(acción por defecto: la salida del LLM no era válida o se acababan los pasos)")}</span>` : "";
      if (ev.action === "search") {
        const f = Object.entries(ev.filters || {}).map(([k, v]) => `<code>${esc(k)}=${esc(v)}</code>`).join(" ");
        return { step: t("Agente"), html: `${head}: ${t("el agente decide {a} {q}", { a: P(t("buscar")), q: P("«" + esc(short(ev.query, 120)) + "»") })}${f ? " " + t("con filtros {f}", { f }) : ""}.${why}${forced}` };
      }
      if (ev.action === "read") return { step: t("Agente"), html: `${head}: ${t("el agente decide {a} la evidencia {ref} para ver el texto completo.", { a: P(t("leer")), ref: P(esc(ev.ref)) })}${why}${forced}` };
      const n = ev.evidence?.length;
      return { step: t("Agente"), html: `${head}: ${n === 0 ? t("el agente decide {a} sin evidencias pertinentes: el sistema se abstendrá.", { a: P(t("terminar")) })
        : n ? t("el agente decide {a} y elige {list}.", { a: P(t("terminar")), list: ev.evidence.map((r) => P(esc(r))).join(", ") })
          : t("el agente decide {a}.", { a: P(t("terminar")) })}${why}${forced}` };
    }
    case "agent_obs":
      if (ev.action === "read") return { step: t("Observación"), html: ev.ok
        ? t("El agente lee {ref} entero: {n} caracteres, con los chunks vecinos de la misma disposición.", { ref: P(esc(ev.ref)), n: P(fmtNum(ev.chars)) })
        : t("La referencia {ref} no existe; el agente recibe la lista de referencias válidas.", { ref: P(esc(ev.ref)) }) };
      if (ev.duplicate) return { step: t("Observación"), html: t("Búsqueda repetida: no se ejecuta y se pide al agente otra consulta.") };
      return { step: t("Observación"), html: ev.results.length
        ? t("Vuelven {n} resultados al agente ({nw} nuevos); el mejor, {ref}, con score {s}. El agente solo ve un extracto de cada uno.", {
          n: P(ev.results.length), nw: ev.results.filter((x) => x.new).length, ref: P(ev.results[0].ref), s: P(fmtScore(ev.results[0].s)) })
        : t("La búsqueda no devuelve nada; el agente tendrá que reformular o quitar filtros.") };
    case "agent_done":
      return { step: t("Evidencias"), html: ev.abstain
        ? t("El agente no elige ninguna evidencia: no se generará una respuesta sin apoyo.")
        : ev.stop === "max_steps"
          ? t("Se agotan los pasos: entran al contexto las {n} evidencias con mejor score de las {m} reunidas.", { n: P(ev.evidence.length), m: ev.n_pool })
          : t("El agente selecciona {n} de las {m} evidencias reunidas, en su orden de relevancia.", { n: P(ev.evidence.length), m: ev.n_pool }) };
    case "llm_start":
      if (ev.purpose === "agent") return { step: t("Agente"), html: t("El agente (LLM) repasa la pregunta y lo que ha reunido hasta ahora y decide el siguiente paso…") };
      if (ev.purpose === "rewrite") return { step: t("Corrección"), html: t("El mejor score del reranker no alcanza {tau}: el retrieval se considera {amb} y el LLM reformula la pregunta…", { tau: P("τ_ok = " + cfg.tau_ok), amb: P(t("ambiguo")) }) };
      if (ev.purpose === "hyde") return { step: "HyDE", html: t("HyDE: el LLM escribe un párrafo hipotético con el estilo del DOGV; su embedding se usa como consulta densa extra.") };
      return { step: t("Generación"), html: t("Se envían {n} fragmentos numerados al LLM con la instrucción de citar [n] y no inventar…", { n: P(ctx.nContexts ?? cfg.top_k) }) };
    case "llm":
      if (ev.purpose === "agent") return { step: t("Agente"), html: t("Decisión del agente en {ms}.", { ms: P(fmtMs(ev.ms)) }) };
      if (ev.purpose === "rewrite") return { step: t("Corrección"), html: t("Reformulaciones: {list}.", { list: esc(ev.output).split("\n").filter(Boolean).slice(0, 3).map((x) => `«${esc(short(x.trim(), 80))}»`).join(", ") }) };
      if (ev.purpose === "hyde") return { step: "HyDE", html: t("Párrafo hipotético: «{text}»", { text: esc(short(ev.output, 200)) }) };
      return { step: t("Generación"), html: t("Respuesta generada en {ms}.", { ms: P(fmtMs(ev.ms)) }) };
    case "result": {
      const v = ev.trace?.verdict;
      const verdict = v === "incorrect" ? " " + t("El evaluador decide {a}: ni tras reformular hay evidencia suficiente.", { a: P(t("abstenerse")) }) :
        v === "ambiguous" ? " " + t("Tras la segunda pasada el mejor score es {s}.", { s: P(fmtScore(ev.trace.second_pass_best)) }) :
          ev.trace?.steps ? " " + t("El agente ha usado {n} pasos y {q} búsquedas.", { n: P(ev.trace.steps.length), q: P(ev.trace.queries.length) }) : "";
      return { step: t("Fin"), html: t("Listo en {ms} con {n} fragmentos en el contexto.", { ms: P(fmtMs(ev.total_ms)), n: P(ev.contexts.length) }) +
        verdict + (ev.generated ? "" : " " + t("(Sin generación: modo solo retrieval.)")) };
    }
    case "error":
      return { step: "Error", html: `<span style="color:var(--bad)">${esc(ev.message)}</span>` };
  }
  return null;
}
