// Fristberechnung für Verträge, Versicherungen und Abos.
// Die App rechnet ausschließlich mit den eingegebenen Werten (keine Rechtsberatung).
//
// Begriffe:
//   Laufzeitende  = letzter Vertragstag der aktuellen Periode (z. B. 31.12. bei Kfz mit Hauptfälligkeit 01.01.)
//   Kündigungsfrist wird rückwärts vom Laufzeitende gerechnet (§ 188 BGB analog):
//   3 Monate zum 30.06. -> Kündigung muss spätestens am 31.03. zugehen.

import { addDays, addMonths, daysBetween } from './dates.js';

export const INTERVALS = {
  'monatlich': 1,
  'vierteljährlich': 3,
  'halbjährlich': 6,
  'jährlich': 12,
  'einmalig': 0,
};

// Letzter Tag einer Periode, die am Tag nach `end` beginnt und `months` dauert
function rollForward(end, months) {
  return addDays(addMonths(addDays(end, 1), months), -1);
}

export function noticeDeadline(end, value, unit) {
  const n = Number(value) || 0;
  if (unit === 'Wochen') return addDays(end, -7 * n);
  if (unit === 'Tage') return addDays(end, -n);
  return addDays(addMonths(addDays(end, 1), -n), -1); // Monate
}

// Erstes Laufzeitende: explizit eingetragen oder Beginn + Mindestlaufzeit
export function initialTermEnd(c) {
  if (c.termEnd) return c.termEnd;
  if (c.start && c.minTermMonths) return rollForward(addDays(c.start, -1), c.minTermMonths);
  return null;
}

/**
 * Nächste relevante Frist eines Vertrags.
 * status:
 *   'unbekannt' – Laufzeitende nicht bestimmbar (Angaben fehlen)
 *   'aktiv'     – verlängert sich automatisch; deadline = letzter Tag für die Kündigung
 *   'endet'     – endet ohne Kündigung am termEnd
 *   'beendet'   – ohne Verlängerung bereits abgelaufen
 */
export function nextDeadline(c, today) {
  let end = initialTermEnd(c);
  if (!end) return { status: 'unbekannt' };
  const renew = Number(c.renewalMonths) || 0;
  const remindDays = c.remindDays ?? 30;

  if (renew <= 0) {
    if (end < today) return { status: 'beendet', termEnd: end };
    const daysLeft = daysBetween(today, end);
    return { status: 'endet', termEnd: end, deadline: null, daysLeft, due: daysLeft <= remindDays };
  }

  let deadline = noticeDeadline(end, c.noticeValue, c.noticeUnit);
  for (let i = 0; deadline < today && i < 2000; i++) {
    end = rollForward(end, renew);
    deadline = noticeDeadline(end, c.noticeValue, c.noticeUnit);
  }
  const daysLeft = daysBetween(today, deadline);
  return { status: 'aktiv', termEnd: end, deadline, daysLeft, due: daysLeft <= remindDays };
}

// Kosten auf den Monat umgerechnet (einmalige Kosten zählen nicht)
export function monthlyCost(c) {
  const months = INTERVALS[c.interval] ?? 1;
  if (!months || !c.cost) return 0;
  return c.cost / months;
}
