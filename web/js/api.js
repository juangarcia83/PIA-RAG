// Cliente de la API del laboratorio.

async function handle(r) {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export const getJSON = (url) => fetch(url).then(handle);
export const postJSON = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(handle);

/** Sube un documento adjunto (PDF, DOCX, TXT) como cuerpo binario; devuelve su ficha ({id, name, pages, mode…}). */
export const uploadAttachment = (file) =>
  fetch(`/api/attachments?name=${encodeURIComponent(file.name)}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
  }).then(handle);

const cache = new Map();
/** GET con caché en memoria para recursos que no cambian durante la sesión. */
export function cached(url) {
  if (!cache.has(url)) cache.set(url, getJSON(url).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

/** Ejecuta una arquitectura y llama a onEvent por cada etapa (NDJSON en streaming). */
export async function streamRun(body, onEvent, signal) {
  const r = await fetch("/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!r.ok) await handle(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      events.push(ev);
      onEvent(ev);
    }
  }
  return events;
}
