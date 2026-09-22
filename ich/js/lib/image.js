// Aufbereitung gescannter Seiten: Foto einlesen, verkleinern, optional drehen und als JPEG neu kodieren.
// Durch das Neukodieren über ein Canvas fallen alle Metadaten weg (EXIF, GPS, Gerät). Siehe docs/features/dokumente.md.

export const SCAN_LIMITS = {
  maxSide: 2000,                    // längste Kante in Pixeln, reicht für lesbare Laborwerte
  quality: 0.85,
  maxInputBytes: 30 * 1024 * 1024,  // größere Dateien werden abgelehnt
  maxOutputBytes: 1.5 * 1024 * 1024,
  maxPages: 20,
};

/** Zielgröße: längste Kante höchstens maxSide, nie vergrößern. */
export function fitSize(w, h, maxSide = SCAN_LIMITS.maxSide) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close?.() };
    } catch { /* Rückfall auf <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, quality) => new Promise((resolve, reject) =>
  canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden.'))), 'image/jpeg', quality));

/**
 * Bereitet ein Foto als Dokumentseite auf. rotate: 0, 90, 180 oder 270 (im Uhrzeigersinn).
 * Liefert { blob, w, h, bytes, mime } oder wirft eine verständliche Fehlermeldung.
 */
export async function processImage(file, { rotate = 0 } = {}) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Bitte ein Foto oder Bild wählen (JPEG, PNG, WebP oder HEIC).');
  if (file.size > SCAN_LIMITS.maxInputBytes) throw new Error('Das Bild ist größer als 30 MB und wird nicht übernommen.');
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden. Bitte als JPEG oder PNG aufnehmen.');
  }
  const { w, h } = fitSize(img.w, img.h);
  const turned = rotate === 90 || rotate === 270;
  const canvas = document.createElement('canvas');
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff'; // transparente Bilder (PNG) auf weißem Grund
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate((rotate * Math.PI) / 180);
  g.drawImage(img.source, -w / 2, -h / 2, w, h);
  img.release();
  try {
    let quality = SCAN_LIMITS.quality;
    let blob = await toBlob(canvas, quality);
    while (blob.size > SCAN_LIMITS.maxOutputBytes && quality > 0.5) {
      quality -= 0.15;
      blob = await toBlob(canvas, quality);
    }
    return { blob, w: canvas.width, h: canvas.height, bytes: blob.size, mime: 'image/jpeg' };
  } finally {
    canvas.width = 0; // Speicher sofort freigeben (wichtig auf iOS)
    canvas.height = 0;
  }
}
