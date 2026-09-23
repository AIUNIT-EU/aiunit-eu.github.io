// Vertragsangaben aus erkanntem Text vorschlagen (DOC-12). Reine Funktionen, ohne DOM.
// Jeder Vorschlag trägt seine Fundstelle (Zeile, Box). Übernommen wird nur, was der Nutzer im Formular bestätigt.

import { CONTRACT_CATEGORIES } from './contract-logic.js';

const DATE = String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})`;
const pad = n => String(n).padStart(2, '0');

function isoDate(d, m, y) {
  let year = Number(y);
  if (year < 100) year += 2000;
  const day = Number(d), month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCDate() !== day) return null; // z. B. 31.02. existiert nicht
  return `${year}-${pad(month)}-${pad(day)}`;
}

const INTERVAL_WORDS = [
  [/monatl|pro monat|je monat|mtl/i, 'monatlich'],
  [/vierteljährl|quartal/i, 'vierteljährlich'],
  [/halbjährl/i, 'halbjährlich'],
  [/jährl|pro jahr|je jahr|jahresbeitrag|p\.\s?a\./i, 'jährlich'],
];

const CATEGORY_WORDS = [
  [/kfz|haftpflicht|hausrat|versicherung|police|versicherungsschein|rechtsschutz|unfall|berufsunfähig/i, 'Versicherung'],
  [/strom|gas|energie|kwh|stadtwerke|arbeitspreis|grundpreis/i, 'Strom / Gas / Energie'],
  [/wasser|abwasser/i, 'Wasser'],
  [/mobilfunk|internet|dsl|glasfaser|telefon|tarif.*gb/i, 'Telefon / Internet / Mobilfunk'],
  [/abo|abonnement|streaming|mitgliedschaft|fitness/i, 'Abo / Streaming'],
];

const COMPANY = /\b(GmbH|AG|SE|KG|KGaA|eG|VVaG|mbH|Versicherung(en)?|Stadtwerke|Energie)\b/;

function hit(field, value, line, extra = {}) {
  return { field, value, line: line.text, page: line.page ?? 0, bbox: line.bbox || null, confidence: line.confidence ?? null, ...extra };
}

/**
 * Liefert Vorschläge { provider, contractNo, cost, interval, start, termEnd, minTermMonths, noticeValue, noticeUnit, category }
 * – jeweils { value, line, page, bbox, confidence } oder fehlend. pages: [{ lines: [{text,bbox,confidence}] }].
 */
export function parseContractPages(pages) {
  const lines = pages.flatMap((p, page) => (p.lines || []).map(l => ({ ...l, page, text: l.text.replace(/\s+/g, ' ').trim() }))).filter(l => l.text);
  const out = {};
  const set = (key, h) => { if (!out[key] && h.value !== null && h.value !== undefined && h.value !== '') out[key] = h; };
  const all = lines.map(l => l.text).join('\n');

  for (const line of lines) {
    const t = line.text;
    let m;
    if ((m = t.match(/(versicherungsschein|vertrags|kunden|police|konto)\s*-?\s*(nummer|nr\.?|no\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9 \-/.]{3,30})/i))) {
      set('contractNo', hit('contractNo', m[3].trim().replace(/[.\s]+$/, ''), line));
    }
    if ((m = t.match(/(beitrag|prämie|praemie|preis|betrag|abschlag|grundgebühr|zahlbetrag)[^0-9€]{0,40}?(?:€\s*)?(\d{1,5}(?:\.\d{3})*,\d{2})\s*(?:€|eur)?/i))) {
      const cost = Number(m[2].replace(/\./g, '').replace(',', '.'));
      set('cost', hit('cost', cost, line));
      const iv = INTERVAL_WORDS.find(([rx]) => rx.test(t));
      if (iv) set('interval', hit('interval', iv[1], line));
    }
    if ((m = t.match(new RegExp(String.raw`(versicherungsbeginn|vertragsbeginn|beginn|gültig ab|lieferbeginn)\s*[:.]?\s*(?:am\s*)?${DATE}`, 'i')))) {
      set('start', hit('start', isoDate(m[2], m[3], m[4]), line));
    }
    if ((m = t.match(new RegExp(String.raw`(ablauf|vertragsende|laufzeitende|endet am|läuft bis|laufzeit bis|hauptfälligkeit)\s*[:.]?\s*(?:am\s*)?${DATE}`, 'i')))) {
      set('termEnd', hit('termEnd', isoDate(m[2], m[3], m[4]), line));
    }
    if ((m = t.match(/kündigungsfrist[^0-9]{0,20}(\d{1,2})\s*(monat|woche|tag)/i))) {
      set('noticeValue', hit('noticeValue', Number(m[1]), line));
      set('noticeUnit', hit('noticeUnit', { monat: 'Monate', woche: 'Wochen', tag: 'Tage' }[m[2].toLowerCase()], line));
    }
    if ((m = t.match(/(mindestlaufzeit|vertragslaufzeit|laufzeit)[^0-9]{0,15}(\d{1,3})\s*(monat|jahr)/i))) {
      const months = Number(m[2]) * (/jahr/i.test(m[3]) ? 12 : 1);
      set('minTermMonths', hit('minTermMonths', months, line));
    }
    if (!out.provider && COMPANY.test(t) && t.length <= 60 && !/nummer|nr\.|beitrag|kündig|straße|str\.|postfach|\d{5}/i.test(t)) {
      set('provider', hit('provider', t.replace(/[,;]+$/, ''), line));
    }
  }

  const cat = CATEGORY_WORDS.find(([rx]) => rx.test(all));
  if (cat && CONTRACT_CATEGORIES.includes(cat[1])) {
    const line = lines.find(l => cat[0].test(l.text));
    out.category = hit('category', cat[1], line);
  }
  return out;
}
