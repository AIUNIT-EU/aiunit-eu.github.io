// M3 – Gesundheit: Blutwerte (module: 'lab'), Medikation und Supplements (module: 'medication')
// Nur Dokumentation. Die App bewertet keine Werte medizinisch; Referenzbereiche stammen aus dem Befund.

import { formatDE } from '../lib/dates.js';
import { openForm } from '../ui/form.js';
import { el, icon, num } from '../ui/dom.js';
import { lineChart } from '../ui/chart.js';
import { docsFor, docList, openDocument, startScan, pageStrip, onDocumentSaved } from './documents.js';

const LAB_PARAMETERS = [
  'Hämoglobin', 'Hämatokrit', 'Erythrozyten', 'Leukozyten', 'Thrombozyten', 'HbA1c', 'Glukose (nüchtern)',
  'Cholesterin gesamt', 'LDL-Cholesterin', 'HDL-Cholesterin', 'Triglyceride', 'Lipoprotein(a)', 'Kreatinin', 'eGFR',
  'Harnsäure', 'GOT (AST)', 'GPT (ALT)', 'Gamma-GT', 'CRP', 'TSH', 'fT3', 'fT4', 'Ferritin', 'Eisen', 'Transferrinsättigung',
  'Vitamin D (25-OH)', 'Vitamin B12', 'Holo-TC', 'Folsäure', 'Magnesium', 'Kalium', 'Natrium', 'Kalzium', 'Zink', 'Selen',
  'Omega-3-Index', 'Homocystein', 'Testosteron', 'PSA',
];
const UNITS = ['g/dl', 'mg/dl', 'mmol/l', 'µmol/l', 'µg/l', 'ng/ml', 'pg/ml', 'nmol/l', 'pmol/l', '%', 'U/l', 'mU/l', '/nl', '/pl', 'ml/min'];
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
  return `${num.format(e.value)}${e.unit ? ` ${e.unit}` : ''}`;
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
  const nodes = [el('div', { class: 'toolbar' },
    el('button', { class: 'primary', id: 'btn-add-lab', onclick: () => editLab(ctx, null) }, icon('plus'), 'Laborwert'))];
  if (!groups.size) {
    nodes.push(el('p', { class: 'muted empty', text: 'Noch keine Blutwerte. Trage die Werte aus deinem Laborbefund ein, um den Verlauf zu sehen.' }));
    return nodes;
  }
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

// ---------- Befunde (gescannte Dokumente) ----------

export function openHealthDoc(ctx, id) {
  const doc = ctx.records.find(r => r.id === id);
  openDocument(id, { actions: [
    el('button', { type: 'button', class: 'primary', id: 'btn-doc-lab', onclick: () => editLab(ctx, null, { date: doc.docDate, source: doc.source, docId: doc.id },
      { before: [pageStrip(doc)], after: () => openHealthDoc(ctx, id) }) }, icon('plus'), 'Laborwert eintragen'),
  ] });
}

onDocumentSaved('health', (doc, ctx) => { section = 'docs'; ctx.showTab('health'); });

function renderDocs(ctx) {
  const docs = docsFor(ctx.records, 'health');
  const nodes = [el('div', { class: 'toolbar' },
    el('button', { class: 'primary', id: 'btn-scan-health', onclick: () => startScan({ area: 'health' }) }, icon('camera'), 'Befund scannen'))];
  if (!docs.length) {
    nodes.push(el('p', { class: 'muted empty', text: 'Noch keine Befunde. Fotografiere einen Laborbefund oder Arztbrief Seite für Seite. Die Werte trägst du danach selbst ein, die App liest nichts automatisch aus.' }));
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
    ...body);
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
