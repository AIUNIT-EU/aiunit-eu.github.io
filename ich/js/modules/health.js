// M3 – Gesundheit: Blutwerte (module: 'lab'), Medikation und Supplements (module: 'medication')
// Nur Dokumentation. Die App bewertet keine Werte medizinisch; Referenzbereiche stammen aus dem Befund.

import { formatDE } from '../lib/dates.js';
import { openForm, openSheet } from '../ui/form.js';
import { el, icon, num } from '../ui/dom.js';
import { lineChart } from '../ui/chart.js';
import { docsFor, docList, openDocument, startScan, pageStrip, onDocumentSaved, recognizeDocument, markablePages } from './documents.js';
import { parseLabPages, findReportDate } from '../lib/parse-lab.js';
import { labInsights, notesFor, doctorQuestions } from '../lib/lab-insights.js';
import { LAB_PARAMETERS, UNITS } from '../lib/lab-catalog.js';

const SUPPLEMENTS = ['Vitamin D3', 'Vitamin D3 + K2', 'Magnesium', 'Omega-3', 'Zink', 'Vitamin B12', 'Eisen', 'Kreatin',
  'Vitamin C', 'Selen', 'Jod', 'Folsäure', 'Kalzium', 'Probiotikum'];

const SECTIONS = [
  { id: 'lab', label: 'Blutwerte' },
  { id: 'Medikament', label: 'Medikation' },
  { id: 'Supplement', label: 'Supplements' },
  { id: 'docs', label: 'Befunde' },
];
let section = 'lab';

// ---------- Blutwerte ----------

export function labFlag(e) {
  if (e.value === null || e.value === undefined) return null;
  if (e.refLow !== null && e.refLow !== undefined && e.value < e.refLow) return 'niedrig';
  if (e.refHigh !== null && e.refHigh !== undefined && e.value > e.refHigh) return 'hoch';
  if (e.refLow != null || e.refHigh != null) return 'ok';
  return null;
}

function labFields(ctx) {
  const known = [...new Set(ctx.records.filter(r => r.module === 'lab').map(r => r.parameter))];
  const docs = docsFor(ctx.records, 'health');
  return [
    { name: 'date', label: 'Datum der Blutabnahme', type: 'date', required: true },
    { name: 'parameter', label: 'Laborwert', required: true, suggest: [...new Set([...known, ...LAB_PARAMETERS])] },
    { name: 'value', label: 'Messwert', type: 'number', required: true, inline: true },
    { name: 'unit', label: 'Einheit', suggest: UNITS, inline: true },
    { name: 'refLow', label: 'Referenz von', type: 'number', inline: true },
    { name: 'refHigh', label: 'Referenz bis', type: 'number', inline: true },
    { name: 'source', label: 'Labor / Praxis' },
    docs.length ? { name: 'docId', label: 'Befunddokument', type: 'select',
      options: [{ value: '', label: 'keins' }, ...docs.map(d => ({ value: d.id, label: `${formatDE(d.docDate)} · ${d.title}` }))] } : null,
    { name: 'notes', label: 'Notizen', type: 'textarea' },
  ].filter(Boolean);
}

function editLab(ctx, entry, preset = {}, { before = [], after = null } = {}) {
  openForm({
    title: entry ? 'Laborwert bearbeiten' : 'Neuer Laborwert',
    fields: labFields(ctx),
    values: entry || { date: ctx.today(), ...preset },
    note: 'Referenzbereich bitte aus deinem Laborbefund übernehmen.',
    before,
    onSave: async data => {
      if (data.refLow !== null && data.refHigh !== null && data.refLow > data.refHigh) throw new Error('„Referenz von“ ist größer als „Referenz bis“.');
      await ctx.save({ ...(entry || { module: 'lab' }), ...data });
      ctx.toast('Laborwert gespeichert');
      if (after) setTimeout(after, 0);
    },
    onDelete: entry ? () => ctx.remove(entry) : null,
  });
}

const FLAG_TEXT = { hoch: '↑ über Referenz', niedrig: '↓ unter Referenz', ok: 'im Referenzbereich' };

function valueText(e) {
  // Originalwert aus dem Befund (z. B. „< 0,5“) hat Vorrang vor der Zahl (HEA-01)
  const shown = e.valueText && /[<>]/.test(e.valueText) ? e.valueText : num.format(e.value);
  return `${shown}${e.unit ? ` ${e.unit}` : ''}`;
}

function refText(e) {
  if (e.refLow != null && e.refHigh != null) return `Ref. ${num.format(e.refLow)}–${num.format(e.refHigh)}`;
  if (e.refLow != null) return `Ref. ≥ ${num.format(e.refLow)}`;
  if (e.refHigh != null) return `Ref. ≤ ${num.format(e.refHigh)}`;
  return '';
}

function renderLab(ctx) {
  const labs = ctx.records.filter(r => r.module === 'lab');
  const groups = new Map();
  for (const e of labs) {
    const k = e.parameter.trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const nodes = [el('div', { class: 'toolbar choice' }, // „Scannen“ und „Selbst eintragen“ gleich groß nebeneinander
    // Direkter Weg: Befund fotografieren → Werte werden auf dem Gerät erkannt → prüfen → übernehmen
    el('button', { class: 'primary', id: 'btn-scan-labs', onclick: () => startScan({ area: 'health', onSaved: doc => scanLabValues(ctx, doc) }) }, icon('camera'), 'Laborwerte scannen'),
    el('button', { class: 'secondary', id: 'btn-add-lab', onclick: () => editLab(ctx, null) }, icon('pencil'), 'Selbst eintragen'))];
  if (!groups.size) {
    nodes.push(el('p', { class: 'muted empty', text: 'Noch keine Blutwerte. „Laborwerte scannen“: Befund fotografieren, die App erkennt die Werte auf dem Gerät, du prüfst und übernimmst sie. „Selbst eintragen“: einen Wert von Hand erfassen. Beides lässt sich später bearbeiten.' }));
    return nodes;
  }
  nodes.push(insightsCard(ctx));
  const sorted = [...groups.values()]
    .map(list => list.sort((a, b) => b.date.localeCompare(a.date)))
    .sort((a, b) => a[0].parameter.localeCompare(b[0].parameter, 'de'));
  for (const list of sorted) {
    const [latest, prev] = list;
    const flag = labFlag(latest);
    let trend = '';
    if (prev && prev.unit === latest.unit) trend = latest.value > prev.value ? ' ↗' : latest.value < prev.value ? ' ↘' : ' →';
    nodes.push(el('article', { class: `entry lab${flag === 'hoch' || flag === 'niedrig' ? ' flagged' : ''}` },
      el('div', { class: 'entry-meta' },
        el('strong', { class: 'lab-name', text: latest.parameter }),
        el('span', { text: formatDE(latest.date) })),
      el('div', { class: 'lab-value' },
        el('strong', { text: valueText(latest) + trend }),
        el('span', { class: 'muted small' }, refText(latest), flag ? ' · ' : '',
          flag ? el('span', { class: flag === 'ok' ? '' : 'flag-out', text: FLAG_TEXT[flag] }) : '')),
      list.length >= 2 ? lineChart(list, { name: latest.parameter, unit: latest.unit, refLow: latest.refLow, refHigh: latest.refHigh, flagText: e => FLAG_TEXT[labFlag(e)] }) : null,
      el('details', {},
        el('summary', { text: `Verlauf (${list.length})` }),
        el('ul', { class: 'history' }, list.map(e => el('li', {},
          el('button', { class: 'link', onclick: () => editLab(ctx, e),
            text: `${formatDE(e.date)}: ${valueText(e)}${labFlag(e) && labFlag(e) !== 'ok' ? ` (${FLAG_TEXT[labFlag(e)]})` : ''}` })))),
        el('button', { class: 'secondary small', onclick: () => editLab(ctx, null,
          { parameter: latest.parameter, unit: latest.unit, refLow: latest.refLow, refHigh: latest.refHigh }) }, icon('plus'), 'Neuer Wert'))));
  }
  return nodes;
}

// ---------- Medikation und Supplements ----------

function medFields(kind) {
  const supp = kind === 'Supplement';
  return [
    { name: 'name', label: supp ? 'Produkt' : 'Handelsname', required: true, suggest: supp ? SUPPLEMENTS : [] },
    { name: 'ingredient', label: 'Wirkstoff' },
    { name: 'strength', label: supp ? 'Dosis pro Einheit' : 'Stärke', hint: 'z. B. 20 mg, 1000 IE' },
    { name: 'morning', label: 'Morgens', inline: true },
    { name: 'noon', label: 'Mittags', inline: true },
    { name: 'evening', label: 'Abends', inline: true },
    { name: 'night', label: 'Nachts', inline: true },
    { name: 'since', label: 'Seit', type: 'date', inline: true },
    { name: 'until', label: 'Bis (leer = dauerhaft)', type: 'date', inline: true },
    { name: 'reason', label: supp ? 'Zweck' : 'Grund' },
    ...(supp ? [] : [{ name: 'prescriber', label: 'Verordnet von' }]),
    { name: 'notes', label: 'Hinweise', type: 'textarea', hint: supp ? '' : 'z. B. vor dem Essen, nicht mit Milch' },
  ];
}

function editMed(ctx, kind, entry) {
  const label = kind === 'Supplement' ? 'Supplement' : 'Medikament';
  openForm({
    title: entry ? `${label} bearbeiten` : `Neues ${label}`,
    fields: medFields(kind),
    values: entry || { since: ctx.today() },
    note: kind === 'Supplement' ? null : 'Nur zur Dokumentation. Änderungen an der Medikation immer mit Arzt oder Apotheke absprechen.',
    onSave: async data => {
      if (data.since && data.until && data.until < data.since) throw new Error('„Bis“ liegt vor „Seit“.');
      await ctx.save({ ...(entry || { module: 'medication', kind }), ...data });
      ctx.toast(`${label} gespeichert`);
    },
    onDelete: entry ? () => ctx.remove(entry) : null,
  });
}

export function scheduleText(m) {
  return [m.morning, m.noon, m.evening, m.night].map(v => v || '0').join(' – ');
}

function medCard(ctx, kind, m) {
  return el('article', { class: 'entry med' },
    el('div', { class: 'entry-meta' },
      el('strong', { class: 'med-name', text: [m.name, m.strength].filter(Boolean).join(' ') }),
      el('span', { class: 'schedule', title: 'morgens – mittags – abends – nachts', text: scheduleText(m) })),
    m.ingredient ? el('div', { class: 'muted small', text: `Wirkstoff: ${m.ingredient}` }) : null,
    el('div', { class: 'small', text: [m.reason, m.since && `seit ${formatDE(m.since)}`, m.until && `bis ${formatDE(m.until)}`].filter(Boolean).join(' · ') }),
    m.notes ? el('div', { class: 'muted small entry-text', text: m.notes }) : null,
    el('div', { class: 'card-actions' },
      el('button', { class: 'secondary small', onclick: () => editMed(ctx, kind, m) }, icon('pencil'), 'Bearbeiten')));
}

function renderMeds(ctx, kind) {
  const today = ctx.today();
  const list = ctx.records.filter(r => r.module === 'medication' && r.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const active = list.filter(m => !m.until || m.until >= today);
  const ended = list.filter(m => m.until && m.until < today);
  const nodes = [el('div', { class: 'toolbar' },
    el('button', { class: 'primary', id: kind === 'Supplement' ? 'btn-add-supp' : 'btn-add-med', onclick: () => editMed(ctx, kind, null) },
      icon('plus'), kind === 'Supplement' ? 'Supplement' : 'Medikament'))];
  if (!list.length) {
    nodes.push(el('p', { class: 'muted empty', text: kind === 'Supplement'
      ? 'Noch keine Supplements eingetragen.'
      : 'Noch kein Medikationsplan. Trage deine Medikamente mit Einnahmezeiten ein.' }));
    return nodes;
  }
  nodes.push(el('p', { class: 'muted small', text: 'Einnahme: morgens – mittags – abends – nachts' }));
  nodes.push(...active.map(m => medCard(ctx, kind, m)));
  if (ended.length) {
    nodes.push(el('details', { class: 'ended-list' },
      el('summary', { text: `Abgesetzt (${ended.length})` }),
      ...ended.map(m => medCard(ctx, kind, m))));
  }
  return nodes;
}

// ---------- Überblick und Fragen für den Arzttermin (lokal, ohne KI, keine Diagnose) ----------

const DISCLAIMER = 'Keine medizinische Bewertung. Die App vergleicht nur mit den Angaben deines Labors und mit deinen früheren Werten.';

function insightsCard(ctx) {
  const r = labInsights(ctx.records, ctx.today());
  const s = r.summary;
  const parts = [
    s.outside.length ? `${s.outside.length} außerhalb des Referenzbereichs` : null,
    s.changed.length ? `${s.changed.length} deutlich verändert` : null,
    s.stale.length ? `${s.stale.length} seit über 12 Monaten nicht gemessen` : null,
    s.incomparable.length ? `${s.incomparable.length} mit Vorwert nicht vergleichbar` : null,
    s.readChecks.length ? `${s.readChecks.length} bitte Eingabe prüfen` : null,
  ].filter(Boolean);
  const flagged = r.items.filter(i => notesFor(i).length);
  const questions = doctorQuestions(r);
  return el('article', { class: 'entry insights', id: 'lab-insights' },
    el('div', { class: 'entry-meta' }, el('strong', { text: 'Überblick' }), el('span', { class: 'muted small', text: `${s.total} ${s.total === 1 ? 'Laborwert' : 'Laborwerte'}` })),
    el('p', { class: 'insights-summary', text: parts.length ? `${parts.join(', ')}.` : 'Alle neuesten Werte liegen im Referenzbereich deines Labors, ohne deutliche Veränderung.' }),
    flagged.length ? el('details', {},
      el('summary', { text: 'Einzelheiten' }),
      el('ul', { class: 'plain-list insights-list' }, flagged.map(i => el('li', {},
        el('strong', { text: `${i.parameter}: ` }), notesFor(i).join('; '))))) : null,
    questions.length ? el('button', { class: 'secondary small', id: 'btn-doctor-questions', onclick: () => showDoctorQuestions(ctx, questions) },
      icon('file-text'), 'Fragen für den Arzttermin') : null,
    el('p', { class: 'muted small', text: DISCLAIMER }));
}

function showDoctorQuestions(ctx, questions) {
  const text = `Fragen für den Arzttermin (erstellt mit ICH am ${formatDE(ctx.today())}):\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n${DISCLAIMER}`;
  const copy = el('button', { type: 'button', class: 'secondary', id: 'btn-questions-copy', onclick: async () => {
    try { await navigator.clipboard.writeText(text); ctx.toast('Fragen kopiert'); } catch { ctx.toast('Kopieren nicht möglich. Bitte den Text markieren und kopieren.'); }
  } }, 'Kopieren');
  const share = typeof navigator.share === 'function' ? el('button', { type: 'button', class: 'primary', id: 'btn-questions-share', onclick: async () => {
    try { await navigator.share({ title: 'Fragen für den Arzttermin', text }); } catch { /* abgebrochen */ }
  } }, 'Teilen') : null;
  openSheet({
    title: 'Fragen für den Arzttermin',
    subtitle: 'zu den auffälligen Werten',
    body: [
      el('ol', { class: 'questions' }, questions.map(q => el('li', { text: q }))),
      el('p', { class: 'muted small', text: `${DISCLAIMER} Die Fragen verlassen das Handy nur, wenn du sie selbst kopierst oder teilst.` }),
    ],
    actions: [copy, share].filter(Boolean),
  });
}

// ---------- Befunde (gescannte Dokumente) ----------

export function openHealthDoc(ctx, id) {
  const doc = ctx.records.find(r => r.id === id);
  const hasValues = ctx.records.some(r => r.module === 'lab' && r.docId === id);
  openDocument(id, {
    // Eingetragene Werte antippen: bearbeiten mit dem Befund als Bild darüber (falsch gescannt → korrigieren)
    onValue: lab => editLab(ctx, lab, {}, { before: [pageStrip(doc)], after: () => openHealthDoc(ctx, id) }),
    actions: [
    el('button', { type: 'button', class: 'primary', id: 'btn-doc-ocr', onclick: () => scanLabValues(ctx, doc) }, icon('scan-text'), hasValues ? 'Erneut erkennen' : 'Werte erkennen'),
    el('button', { type: 'button', class: 'primary', id: 'btn-doc-lab', onclick: () => editLab(ctx, null, { date: doc.docDate, source: doc.source, docId: doc.id },
      { before: [pageStrip(doc)], after: () => openHealthDoc(ctx, id) }) }, icon('plus'), 'Laborwert eintragen'),
  ] });
}

onDocumentSaved('health', (doc, ctx) => { section = 'docs'; ctx.showTab('health'); });

// ---------- Werte aus einem Befund erkennen (lokal, DOC-12) ----------

async function scanLabValues(ctx, doc) {
  const pages = await recognizeDocument(doc);
  if (!pages) return;
  const fresh = ctx.records.find(r => r.id === doc.id) || doc;
  // Schon aus diesem Befund übernommene Werte markieren, damit „Erneut erkennen“ nichts doppelt speichert
  const existing = new Map(ctx.records.filter(r => r.module === 'lab' && r.docId === fresh.id).map(r => [r.parameter.trim().toLowerCase(), r]));
  const candidates = parseLabPages(pages).map(c => {
    const already = existing.get(c.parameter.trim().toLowerCase());
    return already ? { ...c, already, state: 'unklar', reasons: [`bereits eingetragen: ${valueText(already)}`, ...c.reasons] } : c;
  });
  reviewLabValues(ctx, fresh, candidates, { reportDate: findReportDate(pages) });
}

const parseDe = s => {
  const t = String(s ?? '').trim().replace(/^[<>≤≥]\s*/, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
};

/** Prüfliste: Jede erkannte Zeile ist ein Vorschlag. Unklare Zeilen sind nicht vorausgewählt. */
function reviewLabValues(ctx, doc, candidates, { reportDate = null } = {}) {
  const back = () => openHealthDoc(ctx, doc.id);
  if (!candidates.length) {
    openSheet({
      title: 'Keine Laborwerte erkannt',
      body: [el('p', { text: 'Auf den Seiten wurden keine Zeilen mit Laborwert, Zahl und Einheit gefunden. Häufige Ursachen: unscharfes Foto, sehr kleine Schrift oder ein ungewöhnliches Tabellenformat.' }),
        el('p', { class: 'muted small', text: 'Du kannst die Werte wie bisher mit „Laborwert eintragen“ selbst übernehmen; der Befund bleibt dabei sichtbar.' })],
      actions: [el('button', { type: 'button', class: 'primary', onclick: back }, 'Zurück zum Befund')],
    });
    return;
  }
  const { node: pagesNode, mark } = markablePages(doc);
  const rows = candidates.map((c, i) => {
    const check = el('input', { type: 'checkbox', 'aria-label': `${c.parameter} übernehmen` });
    check.checked = c.state === 'erkannt';
    const field = (name, value, label, extra = {}) => el('label', { class: 'ocr-field' }, label,
      el('input', { type: 'text', name, value: value ?? '', inputmode: extra.numeric ? 'decimal' : undefined, autocomplete: 'off' }));
    const row = el('article', { class: `ocr-row ${c.state}`, 'data-index': String(i) },
      el('div', { class: 'ocr-row-head' },
        el('label', { class: 'ocr-check' }, check, el('span', { class: 'ocr-name', text: c.parameter })),
        el('span', { class: `ocr-state ${c.state}`, text: c.state === 'erkannt' ? 'erkannt' : 'unklar' })),
      el('div', { class: 'ocr-fields' },
        field('parameter', c.parameter, 'Laborwert'),
        field('value', c.valueText, 'Wert', { numeric: true }),
        field('unit', c.unit, 'Einheit'),
        field('refLow', c.refLow != null ? num.format(c.refLow) : '', 'Ref. von', { numeric: true }),
        field('refHigh', c.refHigh != null ? num.format(c.refHigh) : '', 'Ref. bis', { numeric: true })),
      [...c.reasons, ...(c.notes || [])].length ? el('p', { class: 'ocr-reasons small', text: [...c.reasons, ...(c.notes || [])].join(' · ') }) : null,
      el('button', { type: 'button', class: 'link ocr-source', onclick: () => mark(c.page, c.bbox) }, `Im Befund zeigen: „${c.line}“`));
    return { row, check, c };
  });
  const error = el('p', { class: 'error', role: 'alert' });
  // Datum der Blutabnahme: aus dem Befundtext erkannt oder Datum des Dokuments; gilt für alle übernommenen Werte
  const dateInput = el('input', { type: 'date', name: 'labDate', value: reportDate || doc.docDate || ctx.today(), required: true });
  const dateBox = el('label', { class: 'ocr-date' }, 'Datum der Blutabnahme', dateInput,
    el('span', { class: 'hint', text: reportDate ? `aus dem Befund erkannt (${formatDE(reportDate)}), bitte prüfen` : 'Datum des Befunds; bei Bedarf ändern' }));
  const save = el('button', { type: 'button', class: 'primary', id: 'btn-ocr-apply' }, 'Übernehmen');
  const count = () => { const n = rows.filter(r => r.check.checked).length; save.textContent = `Übernehmen (${n})`; save.disabled = !n; };
  rows.forEach(r => r.check.addEventListener('change', count));
  count();
  save.onclick = async () => {
    error.textContent = '';
    const labDate = dateInput.value;
    if (!labDate) { error.textContent = 'Bitte das Datum der Blutabnahme angeben.'; return; }
    const chosen = [];
    for (const r of rows.filter(x => x.check.checked)) {
      const get = n => r.row.querySelector(`[name=${n}]`).value.trim();
      const parameter = get('parameter');
      const valueRaw = get('value');
      const value = parseDe(valueRaw);
      const refLow = parseDe(get('refLow'));
      const refHigh = parseDe(get('refHigh'));
      if (!parameter || value === null || Number.isNaN(value)) { error.textContent = `„${parameter || 'Zeile'}“: Laborwert und Wert müssen ausgefüllt sein.`; r.row.scrollIntoView?.({ block: 'center' }); return; }
      if (Number.isNaN(refLow) || Number.isNaN(refHigh)) { error.textContent = `„${parameter}“: Referenz ist keine Zahl.`; return; }
      if (refLow !== null && refHigh !== null && refLow > refHigh) { error.textContent = `„${parameter}“: „Ref. von“ ist größer als „Ref. bis“.`; return; }
      chosen.push({ module: 'lab', date: labDate, source: doc.source || null, docId: doc.id, parameter, value,
        valueText: valueRaw, unit: get('unit') || null, refLow, refHigh, notes: null, origin: 'scan-bestaetigt' });
    }
    save.disabled = true;
    try {
      for (const rec of chosen) await ctx.save(rec, { silent: true });
      // Befund ohne eigenes Datum (heute vorbelegt) übernimmt das bestätigte Abnahmedatum
      if (labDate !== doc.docDate && doc.docDate === (doc.createdAt || '').slice(0, 10)) await ctx.save({ ...doc, docDate: labDate }, { silent: true });
    } catch (err) {
      error.textContent = err.message || 'Speichern fehlgeschlagen.';
      save.disabled = false;
      return;
    }
    // Gespeichert wurde still (das Blatt bleibt offen); die Blutwerte-Ansicht dahinter jetzt einmal neu aufbauen
    const tab = document.getElementById('tab-health');
    if (tab && !tab.hidden) render(tab, ctx);
    ctx.toast(`${chosen.length} ${chosen.length === 1 ? 'Laborwert' : 'Laborwerte'} übernommen`);
    back();
  };
  const unclear = candidates.filter(c => c.state !== 'erkannt').length;
  openSheet({
    title: 'Erkannte Werte prüfen',
    subtitle: `${candidates.length} gefunden${unclear ? `, davon ${unclear} unklar` : ''} · nichts ist gespeichert`,
    body: [
      el('p', { class: 'muted small', text: 'Vergleiche jeden Wert mit dem Befund. Unklare Zeilen sind nicht ausgewählt. Die App deutet keine Werte.' }),
      dateBox,
      el('div', { class: 'ocr-list' }, rows.map(r => r.row)),
      error,
      el('h3', { text: 'Befund' }),
      pagesNode,
    ],
    actions: [el('button', { type: 'button', class: 'secondary', onclick: back }, 'Verwerfen'), save],
  });
}

function renderDocs(ctx) {
  const docs = docsFor(ctx.records, 'health');
  const nodes = [el('div', { class: 'toolbar' },
    el('button', { class: 'primary', id: 'btn-scan-health', onclick: () => startScan({ area: 'health' }) }, icon('camera'), 'Befund scannen'))];
  if (!docs.length) {
    nodes.push(el('p', { class: 'muted empty', text: 'Noch keine Befunde. Fotografiere einen Laborbefund oder Arztbrief Seite für Seite. Danach kann die App die Werte auf dem Gerät erkennen; du prüfst sie, bevor etwas gespeichert wird.' }));
    return nodes;
  }
  nodes.push(docList(docs, id => openHealthDoc(ctx, id)));
  return nodes;
}

// ---------- Ansicht ----------

export function render(root, ctx) {
  const tabs = el('div', { class: 'segmented', role: 'tablist' },
    SECTIONS.map(s => el('button', {
      role: 'tab', 'aria-selected': String(s.id === section), class: s.id === section ? 'active' : '',
      text: s.label, onclick: () => { section = s.id; render(root, ctx); },
    })));
  const body = section === 'lab' ? renderLab(ctx) : section === 'docs' ? renderDocs(ctx) : renderMeds(ctx, section);
  root.replaceChildren(
    tabs,
    el('p', { class: 'muted small', text: 'Nur zur persönlichen Dokumentation, keine medizinische Bewertung.' }),
    ...body.filter(Boolean)); // replaceChildren würde null als Text „null“ anzeigen
}

// ---------- Für die Übersicht ----------

export function setSection(id) {
  if (SECTIONS.some(s => s.id === id)) section = id;
}

export function activeMedications(records, today) {
  return records.filter(r => r.module === 'medication' && (!r.until || r.until >= today))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'de'));
}

// Letzter Wert je Laborparameter, auffällige zuerst
export function latestLabs(records) {
  const latest = new Map();
  for (const e of records.filter(r => r.module === 'lab')) {
    const k = e.parameter.trim().toLowerCase();
    if (!latest.has(k) || latest.get(k).date < e.date) latest.set(k, e);
  }
  return [...latest.values()].map(e => ({ e, flag: labFlag(e) }))
    .sort((a, b) => Number(b.flag === 'hoch' || b.flag === 'niedrig') - Number(a.flag === 'hoch' || a.flag === 'niedrig') || b.e.date.localeCompare(a.e.date));
}

export { valueText, FLAG_TEXT, editLab, editMed };
