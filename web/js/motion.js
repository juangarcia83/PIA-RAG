// Capa de movimiento: entradas escalonadas al hacer scroll, cifras que cuentan, luz que sigue al cursor en las
// tarjetas e indicador deslizante en la navegación. Todo se desactiva con «reducir movimiento».
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ entradas al hacer scroll
const REVEAL = ".card, .section-title, .hero-text > *, .hero-art, .search, .toolbar, .suggest";
const seen = new WeakSet();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    io.unobserve(e.target);
  }
}, { rootMargin: "0px 0px -6% 0px" });

function reveal(root) {
  if (still()) return;
  let i = 0;
  root.querySelectorAll(REVEAL).forEach((el) => {
    if (seen.has(el) || el.closest(".sheet, .modal")) return;
    seen.add(el);
    el.classList.add("reveal");
    el.style.setProperty("--d", `${Math.min(i++, 8) * 55}ms`);
    io.observe(el);
  });
}

// ------------------------------------------------------------------ cifras que cuentan
function countUp(el) {
  if (seen.has(el) || still()) return;
  seen.add(el);
  const raw = el.textContent.trim();
  const m = raw.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(\s*%?)$/);   // enteros con separador de miles «2.144» o «12%»
  if (!m) return;
  const target = Number(m[1].replace(/\./g, "")), suffix = m[2];
  const t0 = performance.now(), dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    el.textContent = Math.round(target * e).toLocaleString("es-ES") + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ luz que sigue al cursor
let pending = null;
addEventListener("pointermove", (ev) => {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = null;
    const card = ev.target.closest?.(".card, .src, .chip, .search-box");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
    card.style.setProperty("--my", `${ev.clientY - r.top}px`);
  });
}, { passive: true });

// ------------------------------------------------------------------ indicador deslizante de la navegación
export function moveTabInk() {
  const tabs = document.querySelector(".tabs");
  const sel = tabs?.querySelector('.tab[aria-selected="true"]');
  if (!tabs || !sel) return;
  let ink = tabs.querySelector(".tab-ink");
  if (!ink) { ink = document.createElement("span"); ink.className = "tab-ink"; tabs.append(ink); }
  ink.style.width = `${sel.offsetWidth - 24}px`;
  ink.style.transform = `translateX(${sel.offsetLeft + 12}px)`;
}
addEventListener("resize", moveTabInk);
document.fonts?.ready.then(moveTabInk);

// ------------------------------------------------------------------ arranque
export function startMotion(app) {
  const scan = () => {
    reveal(app);
    app.querySelectorAll(".stat .v").forEach(countUp);
  };
  new MutationObserver(() => requestAnimationFrame(scan)).observe(app, { childList: true, subtree: true });
  scan();
}

/** Entrada escalonada de los hijos de un bloque (párrafos de una respuesta, tarjetas de fuentes…). */
export function stagger(el, step = 70) {
  if (still()) return;
  [...el.children].forEach((c, i) => c.style.setProperty("--i", i));
  el.style.setProperty("--step", `${step}ms`);
  el.classList.remove("stream");
  void el.offsetWidth;   // reinicia la animación si ya estaba aplicada
  el.classList.add("stream");
}
