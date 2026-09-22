// Datumsfunktionen auf Basis von 'YYYY-MM-DD'-Strings (Kalendertage, zeitzonenunabhängig).

const pad = n => String(n).padStart(2, '0');

export function toISODate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

// Heutiges Datum in lokaler Zeit
export function todayISO(now = new Date()) {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(iso, days) {
  const { y, m, d } = parseISODate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Monate addieren; ungültige Tage werden auf das Monatsende gekürzt (31.01. + 1 Monat = 28./29.02.)
export function addMonths(iso, months) {
  const { y, m, d } = parseISODate(iso);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return toISODate(ny, nm, Math.min(d, lastDay));
}

export function daysBetween(fromIso, toIso) {
  const a = parseISODate(fromIso), b = parseISODate(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function formatDE(iso) {
  if (!iso) return '';
  const { y, m, d } = parseISODate(iso);
  return `${pad(d)}.${pad(m)}.${y}`;
}

/**
 * Kalendertag eines Zeitpunkts in einer bestimmten Zeitzone ('YYYY-MM-DD').
 * Ein Tagebucheintrag gehört zu dem Tag, den seine eigene Zeitzone zeigt, nicht die des Geräts.
 */
export function localDateIn(isoInstant, timeZone) {
  const date = new Date(isoInstant);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

/** Liegt der Kalendertag im Zeitraum? Grenzen einschließlich, fehlende Grenze = offen. Vertauschte Grenzen werden getauscht. */
export function inDateRange(dayIso, from, to) {
  let a = from || null, b = to || null;
  if (a && b && a > b) [a, b] = [b, a];
  return (!a || dayIso >= a) && (!b || dayIso <= b);
}
