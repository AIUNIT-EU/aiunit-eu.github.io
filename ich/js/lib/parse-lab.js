// Laborwerte aus erkannten Textzeilen ableiten (DOC-12). Reine Funktionen, ohne DOM.
// Grundsatz: nichts erfinden. Was nicht eindeutig ist, wird als „unklar“ markiert und nicht vorausgewählt.
// Übernommen wird ein Wert erst nach Bestätigung durch den Nutzer (js/modules/health.js).

import { LAB_PARAMETERS, UNITS } from './lab-catalog.js';

/** Unterhalb dieser Zeilensicherheit (Tesseract, 0–100) gilt eine Zeile immer als unklar. */
export const MIN_CONFIDENCE = 60;

const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Buchstabengerüst einer Einheit: „l“-ähnliche Zeichen vereinheitlicht, Schrägstriche entfernt (mU1 → mul = mU/l)
const skeleton = s => s.toLowerCase().replace(/[1i!|]/g, 'l').replace(/[/\s]/g, '');
const SKELETONS = new Map();
for (const u of UNITS) {
  const k = skeleton(u);
  SKELETONS.set(k, SKELETONS.has(k) ? null : u); // mehrdeutige Gerüste (null) werden nie verwendet
}

// Häufige Lesefehler bei Einheiten: µ wird als u, y oder p gelesen, „/l“ als „N“, „^“ als „°“, „%“ oder „*“.
function normalizeUnit(raw) {
  if (!raw) return null;
  let u = raw.trim().replace(/[.,;:]+$/, '');
  u = u.replace(/^10\s*[°^*%]\s*(\d{1,2})\s*\/\s*[uyµp]l$/i, '10^$1/µl')
    .replace(/^10\s*[°^*%]\s*(\d{1,2})\s*\/\s*l$/i, '10^$1/l')
    .replace(/^[uy](g|mol|IU)\//, 'µ$1/')
    .replace(/^mUN$/, 'mU/l').replace(/^U[Nn]$/, 'U/l').replace(/^un$/, 'U/l').replace(/^mmolN$/i, 'mmol/l')
    .replace(/\/I$/, '/l');
  const find = v => UNITS.find(x => x.toLowerCase() === v.toLowerCase());
  // „l“ am Ende wird oft als i, I, 1, ! oder | gelesen (ng/mi, mg/dI, mmol/1); sonst eindeutiges Buchstabengerüst
  if (u.length < 2) return find(u) || null;
  return find(u) || find(u.replace(/[iI1|!]$/, 'l')) || SKELETONS.get(skeleton(u)) || null;
}

function matchParameter(name) {
  const n = norm(name);
  if (n.length < 2) return null;
  let hit = LAB_PARAMETERS.find(p => norm(p) === n);
  if (!hit) hit = LAB_PARAMETERS.find(p => { const q = norm(p); return q.length >= 3 && (n.startsWith(q) || q.startsWith(n)); });
  return hit || null;
}

// Zahl: mit Tausenderpunkten (1.234,5) oder einfach (42,5 / 0.5 / 18)
const NUM = String.raw`(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;
// Deutsche Schreibweise: Komma ist Dezimaltrennzeichen, Punkt vor einem Komma ist Tausendertrennzeichen
const toNumber = s => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
const DATE = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/;
const SKIP = /^(untersuchung|parameter|analyse|test|befund|labor|patient|name|geb|datum|seite|probe|material|einsender|auftrag|ergebnis|referenz)/i;

/**
 * Wertet eine Textzeile aus. Ergebnis null, wenn die Zeile kein Laborwert sein kann (Überschrift, Datum, Fließtext).
 * Sonst { parameter, rawName, valueText, value, comparator, unit, rawUnit, refLow, refHigh, refText, line, bbox, confidence, state, reasons[], notes[] }.
 */
export function parseLabLine(line, opts = {}) {
  const text = line.text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const first = text.match(new RegExp(String.raw`(^|\s)([<>≤≥]\s*)?(${NUM})(?=\s|$)`));
  if (!first) return null;
  const rawName = text.slice(0, first.index).replace(/[:.\-\s]+$/, '').trim();
  if (!/[a-zäöüß]{2,}/i.test(rawName) || SKIP.test(rawName) || DATE.test(text.slice(0, first.index + first[0].length + 6))) return null;

  const comparator = first[2] ? first[2].trim().replace('≤', '<').replace('≥', '>') : null;
  const valueText = `${comparator ? `${comparator} ` : ''}${first[3]}`;
  const rest = text.slice(first.index + first[0].length).trim();

  // Einheit: erstes Wort nach dem Wert, das keine Zahl und kein Bereich ist
  const unitMatch = rest.match(/^(10\s*[°^*%]\s*\d{1,2}\s*\/\s*\S+|[^\s\d<>≤≥-][^\s]*|%)/);
  const rawUnit = unitMatch ? unitMatch[1] : null;
  const unit = normalizeUnit(rawUnit);
  let after = unitMatch ? rest.slice(unitMatch[0].length).trim() : rest;

  // Referenz: „a - b“, „< b“, „> a“
  let refLow = null, refHigh = null, refText = null;
  let m;
  if ((m = after.match(new RegExp(String.raw`^(${NUM})\s*-\s*(${NUM})`)))) {
    refLow = toNumber(m[1]); refHigh = toNumber(m[2]); refText = `${m[1]} - ${m[2]}`;
  } else if ((m = after.match(new RegExp(String.raw`^([<≤])\s*(${NUM})`)))) {
    refHigh = toNumber(m[2]); refText = `< ${m[2]}`;
  } else if ((m = after.match(new RegExp(String.raw`^([>≥])\s*(${NUM})`)))) {
    refLow = toNumber(m[2]); refText = `> ${m[2]}`;
  }
  if (m) after = after.slice(m[0].length).trim();

  const parameter = matchParameter(rawName);
  const value = toNumber(first[3]);
  const reasons = [];
  const notes = [];
  if (!parameter) reasons.push('Laborwert nicht in der Liste, Name bitte prüfen');
  if (!unit) reasons.push(rawUnit ? `Einheit „${rawUnit}“ nicht sicher erkannt` : 'keine Einheit erkannt');
  // Eine einzelne Zahl hinter der Referenz ist der Vorwert, wenn der Befund eine Vorwert-Spalte hat (siehe parseLabPages)
  const extra = after.match(new RegExp(String.raw`^(${NUM})$`));
  let previous = null;
  if (extra && refText && opts.previousColumn) { previous = extra[1]; notes.push(`Vorwert ${previous} nicht übernommen`); }
  else if (new RegExp(NUM).test(after)) reasons.push('weitere Zahl in der Zeile (z. B. Vorwert), Zuordnung unsicher');
  if ((line.confidence ?? 100) < MIN_CONFIDENCE) reasons.push('Text schlecht lesbar');
  // Plausibilität: Ein verlorenes Komma macht aus 5,4 eine 54. Liegt der Wert um ein Vielfaches neben dem Referenzbereich,
  // wird er nicht vorausgewählt. Das ist keine medizinische Bewertung, nur eine Leseprüfung.
  if ((refHigh && value > refHigh * 8) || (refLow && value < refLow / 8)) reasons.push('Wert passt nicht zur Größenordnung der Referenz, Komma prüfen');

  return {
    parameter: parameter || rawName,
    rawName,
    valueText,
    value,
    previous,
    comparator,
    unit: unit || rawUnit || null,
    rawUnit,
    refLow, refHigh, refText,
    line: text,
    bbox: line.bbox || null,
    confidence: line.confidence ?? null,
    state: reasons.length ? 'unklar' : 'erkannt',
    reasons,
    // Hinweise ohne Einfluss auf den Zustand, z. B. Einheit aus einem typischen Lesefehler abgeleitet
    notes: [...notes, ...(unit && rawUnit && unit.toLowerCase() !== rawUnit.toLowerCase() ? [`Einheit gelesen als „${rawUnit}“`] : [])],
  };
}

/** Wertet alle Zeilen aller Seiten aus. pages: [{ lines: [{text,bbox,confidence}] }]. Doppelte Parameter bleiben erhalten, werden aber unklar. */
export function parseLabPages(pages) {
  const out = [];
  pages.forEach((page, pageIndex) => {
    // Kopfzeile mit einer Vorwert-Spalte: dann ist eine einzelne Zahl hinter der Referenz der Vorwert
    const previousColumn = (page.lines || []).some(l => /\b(vorwert|vorbefund|voruntersuchung|vorherig)/i.test(l.text) && !new RegExp(NUM).test(l.text));
    for (const line of page.lines || []) {
      const c = parseLabLine(line, { previousColumn });
      if (c) out.push({ ...c, page: pageIndex });
    }
  });
  const seen = new Map();
  for (const c of out) seen.set(c.parameter, (seen.get(c.parameter) || 0) + 1);
  for (const c of out) {
    if (seen.get(c.parameter) > 1) { c.state = 'unklar'; c.reasons.push('mehrfach im Dokument'); }
  }
  return out;
}

/**
 * Datum des Befunds bzw. der Blutabnahme im erkannten Text suchen ('YYYY-MM-DD' oder null).
 * Bevorzugt Zeilen mit Stichwort (Abnahme, Entnahme, Befund, Eingang, Datum); Geburtsdaten werden übergangen.
 */
export function findReportDate(pages) {
  const lines = pages.flatMap(p => p.lines || []).map(l => l.text);
  const rx = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/;
  const toIso = m => {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = Number(m[1]), mo = Number(m[2]);
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (mo < 1 || mo > 12 || t.getUTCDate() !== d || y < 1990) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const candidates = [];
  for (const text of lines) {
    if (/geb\.|geboren|geburt/i.test(text)) continue;
    const m = text.match(rx);
    if (!m) continue;
    const iso = toIso(m);
    if (!iso) continue;
    const rank = /abnahme|entnahme|probe/i.test(text) ? 0 : /befund|bericht|eingang|datum|vom/i.test(text) ? 1 : 2;
    candidates.push({ iso, rank });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.iso || null;
}
