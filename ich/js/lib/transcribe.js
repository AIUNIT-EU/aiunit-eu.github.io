// Sprachnotizen lokal in Text umwandeln (ADR-0008). Das Audio verlässt das Gerät nicht.
// Ergebnis ist ein Vorschlag: Der Nutzer bearbeitet ihn und übernimmt ihn ausdrücklich in den Eintrag.

const SAMPLE_RATE = 16000;
let worker = null;

/** Audio (Blob, z. B. webm/opus oder mp4/aac) in 16 kHz mono Float32 umwandeln. */
export async function decodeTo16kMono(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const off = new OfflineAudioContext(1, frames, SAMPLE_RATE); // mischt Kanäle zu mono und rechnet auf 16 kHz um
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  } finally {
    ctx.close?.();
  }
}

/**
 * Wandelt eine Aufnahme in Text um. onProgress({ phase: 'load'|'run', progress: 0–1 }).
 * Wirft bei Fehlern; stop() bricht ab.
 */
export async function transcribe(blob, { onProgress } = {}) {
  const audio = await decodeTo16kMono(blob);
  if (!worker) worker = new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data);
      else if (data.type === 'done') resolve(data.text);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    w.onerror = e => reject(new Error(e.message || 'Spracherkennung fehlgeschlagen'));
    w._reject = reject;
    w.postMessage({ type: 'run', audio }, [audio.buffer]);
  });
}

/** Worker beenden (Abbrechen, Sperren): Modell und Text verschwinden aus dem Arbeitsspeicher. */
export function stop() {
  if (!worker) return;
  worker._reject?.(Object.assign(new Error('abgebrochen'), { name: 'AbortError' }));
  worker.terminate();
  worker = null;
}
