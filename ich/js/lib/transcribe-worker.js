// Worker für die lokale Spracherkennung (ADR-0008): Whisper Base über Transformers.js + ONNX Runtime Web.
// Läuft getrennt von der Oberfläche; lädt Bibliothek, Laufzeit und Modell ausschließlich von der eigenen Herkunft.
import { pipeline, env } from '../../vendor/transformers/transformers.min.js';

env.allowRemoteModels = false;               // nie vom Hugging-Face-Hub laden
env.allowLocalModels = true;
// Relativ zum Worker-Skript (js/lib/). Keine absolute Adresse: Die Bibliothek prüft lokale Dateien nur bei Pfaden, nicht bei URLs
env.localModelPath = '../../vendor/whisper/';
env.useBrowserCache = false;                  // keine zweite Kopie im Cache-Speicher; der Service Worker hält vendor/ offline bereit
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;        // GitHub Pages kann keine Cross-Origin-Isolation (Threads) setzen

let asr = null;

self.onmessage = async ({ data }) => {
  if (data?.type !== 'run') return;
  try {
    if (!asr) {
      asr = await pipeline('automatic-speech-recognition', 'whisper-base', {
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
        device: 'wasm',
        progress_callback: p => {
          if (p.status === 'progress' && typeof p.progress === 'number') self.postMessage({ type: 'progress', phase: 'load', file: p.file, progress: p.progress / 100 });
        },
      });
    }
    self.postMessage({ type: 'progress', phase: 'run', progress: 0 });
    const out = await asr(data.audio, { language: 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: 'done', text: (out?.text || '').trim() });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
