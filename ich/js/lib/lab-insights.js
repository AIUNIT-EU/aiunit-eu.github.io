// Überblick über Laborwerte (Teil D, Entscheidung Tom 2026-09-22: lokal, ohne KI, keine Diagnose).
// Die Funktionen vergleichen nur mit den Angaben des Labors und mit früheren eigenen Werten.
// Sie nennen keine Ursachen, keine Diagnosen und keine Empfehlungen.

import { daysBetween, formatDE } from './dates.js';

/** Ab welcher Änderung zum Vorwert ein Wert als „deutlich verändert“ gilt (Anteil, 0,25 = 25 %). */
export const CHANGE_THRESHOLD = 0.25;
/** Ab wie vielen Tagen ohne neue Messung ein Hinweis erscheint. */
export const STALE_DAYS = 365;

const fmt = n => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(n);
const shown = e => `${e.valueText && /[<>]/.test(e.valueText) ? e.valueText : fmt(e.value)}${e.unit ? ` ${e.unit}` : ''}`;

export function refLabel(e) {
  if (e.refLow != null && e.refHigh != null) return `Ref. ${fmt(e.refLow)}–${fmt(e.refHigh)}`;
  if (e.refLow != null) return `Ref. ≥ ${fmt(e.refLow)}`;
  if (e.refHigh != null) return `Ref. ≤ ${fmt(e.refHigh)}`;
  return null;
}

/** Lage zum Referenzbereich des Labors: 'hoch' | 'niedrig' | 'ok' | null (kein Bereich). */
export function position(e) {
  if (e.value == null) return null;
  // „< 0,5“ bei Obergrenze 5 ist sicher unterhalb, nie „hoch“
  if (e.refLow != null && e.value < e.refLow && !/^>/.test(e.valueText || '')) return 'niedrig';
  if (e.refHigh != null && e.value > e.refHigh && !/^</.test(e.valueText || '')) return 'hoch';
  if (e.refLow != null || e.refHigh != null) return 'ok';
  return null;
}

/**
 * Überblick je Laborwert (neuester Wert). records: alle Datensätze; today: 'YYYY-MM-DD'.
 * Ergebnis: { items: [{ parameter, latest, previous, count, position, change, comparable, stale, daysSince, readCheck }], summary }
 */
export function labInsights(records, today) {
  const groups = new Map();
  for (const e of records.filter(r => r.module === 'lab' && r.parameter && r.date)) {
    const k = e.parameter.trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const items = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const [latest, previous] = list;
    const comparable = !!previous && (previous.unit || '') === (latest.unit || '');
    let change = null;
    if (comparable && previous.value) change = (latest.value - previous.value) / Math.abs(previous.value);
    const daysSince = daysBetween(latest.date, today);
    const readCheck = (latest.refHigh && latest.value > latest.refHigh * 8) || (latest.refLow && latest.value < latest.refLow / 8);
    items.push({
      parameter: latest.parameter, latest, previous: previous || null, count: list.length,
      position: position(latest), change, comparable: previous ? comparable : null,
      stale: daysSince >= STALE_DAYS, daysSince, readCheck: !!readCheck,
    });
  }
  items.sort((a, b) => a.parameter.localeCompare(b.parameter, 'de'));
  const outside = items.filter(i => i.position === 'hoch' || i.position === 'niedrig');
  const changed = items.filter(i => i.change !== null && Math.abs(i.change) >= CHANGE_THRESHOLD);
  const stale = items.filter(i => i.stale);
  const incomparable = items.filter(i => i.comparable === false);
  const readChecks = items.filter(i => i.readCheck);
  return { items, summary: { total: items.length, outside, changed, stale, incomparable, readChecks } };
}

/** Hinweise je Laborwert als kurze, neutrale Sätze (ohne Deutung). */
export function notesFor(i) {
  const out = [];
  const ref = refLabel(i.latest);
  if (i.position === 'hoch') out.push(`über dem Referenzbereich des Labors (${ref})`);
  if (i.position === 'niedrig') out.push(`unter dem Referenzbereich des Labors (${ref})`);
  if (i.change !== null && Math.abs(i.change) >= CHANGE_THRESHOLD) {
    out.push(`seit ${formatDE(i.previous.date)} um ${Math.round(Math.abs(i.change) * 100)} % ${i.change > 0 ? 'gestiegen' : 'gesunken'} (vorher ${shown(i.previous)})`);
  }
  if (i.comparable === false) out.push(`mit dem Vorwert nicht vergleichbar (andere Einheit: ${i.previous.unit || 'keine'} → ${i.latest.unit || 'keine'})`);
  if (i.stale) out.push(`zuletzt gemessen vor ${Math.floor(i.daysSince / 30)} Monaten`);
  if (i.readCheck) out.push('Wert passt nicht zur Größenordnung der Referenz; bitte Eingabe mit dem Befund vergleichen (Komma?)');
  return out;
}

/**
 * Fragen für den Arzttermin: nur für auffällige Werte, neutral formuliert, ohne Ursachen oder Empfehlungen.
 * Liefert eine Liste von Sätzen.
 */
export function doctorQuestions(insights) {
  const q = [];
  for (const i of insights.items) {
    const v = shown(i.latest);
    const ref = refLabel(i.latest);
    if (i.position === 'hoch' || i.position === 'niedrig') {
      q.push(`${i.parameter} liegt ${i.position === 'hoch' ? 'über' : 'unter'} dem Referenzbereich des Labors (${v}, ${ref}, ${formatDE(i.latest.date)}). Was bedeutet das in meinem Fall, und sollte der Wert kontrolliert werden?`);
    } else if (i.change !== null && Math.abs(i.change) >= CHANGE_THRESHOLD) {
      q.push(`${i.parameter} hat sich seit ${formatDE(i.previous.date)} um ${Math.round(Math.abs(i.change) * 100)} % ${i.change > 0 ? 'erhöht' : 'verringert'} (${shown(i.previous)} → ${v}). Ist diese Veränderung für mich von Bedeutung?`);
    }
    if (i.stale && (i.position === 'hoch' || i.position === 'niedrig')) {
      q.push(`${i.parameter} wurde zuletzt am ${formatDE(i.latest.date)} gemessen. Ist eine erneute Messung sinnvoll?`);
    }
  }
  return q;
}
