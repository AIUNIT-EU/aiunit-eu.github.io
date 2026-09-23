// Lokale Texterkennung (DOC-12, ADR-0007) mit Tesseract.js aus vendor/tesseract/.
// Läuft vollständig auf dem Gerät: Bibliothek, Worker, Kern und Sprachdaten kommen von der eigenen Herkunft,
// es gibt keinen Cloud-Rückfallweg. Das Ergebnis bleibt im Arbeitsspeicher, bis der Nutzer Werte bestätigt.

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;


let workerPromise = null;
let progressHandler = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { default: Tesseract } = await import(`${BASE}tesseract.esm.min.js`);
      return Tesseract.createWorker('deu', Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${BASE}worker.min.js`,
        corePath: `${BASE}core`,
        langPath: `${BASE}lang`,
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'none', // keine Kopie der Sprachdaten in IndexedDB; der Service Worker hält sie offline bereit
        logger: m => progressHandler?.(m),
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/**
 * Erkennt Text auf einem Bild (Blob). Liefert Zeilen mit Text, Box (Pixel im Originalbild) und Sicherheit 0–100.
 * onProgress erhält Werte 0–1 für Laden und Erkennen.
 */
export async function recognize(blob, { onProgress } = {}) {
  progressHandler = m => {
    if (typeof m?.progress !== 'number') return;
    const loading = m.status !== 'recognizing text';
    onProgress?.(loading ? m.progress * 0.3 : 0.3 + m.progress * 0.7);
  };
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const text = (line.text || '').replace(/\s+/g, ' ').trim();
          if (text) lines.push({ text, bbox: line.bbox, confidence: line.confidence });
        }
      }
    }
    return { text: data.text || '', lines };
  } finally {
    progressHandler = null;
  }
}

/** Beendet den Worker (beim Sperren und nach der Erkennung), damit kein erkannter Text im Speicher bleibt. */
export async function stop() {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try { (await pending).terminate(); } catch { /* bereits beendet */ }
}
