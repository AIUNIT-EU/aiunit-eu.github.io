// Dokumente scannen und ablegen (module: 'document'), siehe docs/features/dokumente.md.
//
// Datensatz: { id, module: 'document', area: 'health'|'contracts', linkedId (Vertrags-ID oder null), kind, title,
//              docDate, source, note, pages: [{ blobId, mime, w, h, bytes }] }
// Jede Seite wird sofort nach der Aufnahme verschlüsselt gespeichert und in einem angefangenen Scan
// (Konfigurationsdatensatz 'scan') gemerkt. So gehen keine Seiten verloren, falls das Handy die App beim
// Öffnen der Kamera beendet. Die App liest keine Werte aus den Bildern aus (keine OCR).

import { SCAN_LIMITS, processImage } from '../lib/image.js';
import { formatDE } from '../lib/dates.js';
import { openForm, openSheet, closeForm } from '../ui/form.js';
import { el, icon, num } from '../ui/dom.js';

export const KINDS = {
  health: ['Laborbefund', 'Arztbrief', 'Sonstiger Befund', 'Rezept', 'Impfnachweis', 'Sonstiges'],
  contracts: ['Police / Vertrag', 'Rechnung', 'Beitragsanpassung', 'Kündigung / Bestätigung', 'Schriftverkehr', 'Sonstiges'],
};

const st = { ctx: null, urls: new Map(), busy: false, onSaved: null };
const afterSaveByArea = {}; // Rücksprung je Bereich, gilt auch für einen nach dem Neuladen fortgesetzten Scan

/** Bereich registriert, wohin es nach dem Speichern geht: fn(doc, ctx). */
export function onDocumentSaved(area, fn) {
  afterSaveByArea[area] = fn;
}
const uuid = () => crypto.randomUUID();
const size = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const pagesText = n => `${n} ${n === 1 ? 'Seite' : 'Seiten'}`;

export const docsFor = (records, area, linkedId) => records
  .filter(r => r.module === 'document' && r.area === area && (linkedId === undefined || r.linkedId === linkedId))
  .sort((a, b) => (b.docDate || '').localeCompare(a.docDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

// ---------- Angefangener Scan ----------

function usedBlobIds() {
  return new Set(st.ctx.records.filter(r => r.module === 'document').flatMap(r => r.pages.map(p => p.blobId)));
}

/** Angefangener Scan; Seiten, die schon zu einem gespeicherten Dokument gehören, zählen nie dazu. */
function draft() {
  const d = st.ctx.getConfig('scan');
  if (!d?.area) return null;
  const used = usedBlobIds();
  return { area: d.area, linkedId: d.linkedId || null, pages: (d.pages || []).filter(p => !used.has(p.blobId)) };
}
const saveDraft = d => st.ctx.saveConfig('scan', d, { silent: true });

async function discardDraft() {
  const d = draft();
  await saveDraft({ area: null, linkedId: null, pages: [] });
  if (d?.pages.length) {
    await st.ctx.removeBlobs(d.pages.map(p => p.blobId)).catch(() => {}); // schlimmstenfalls bleibt verschlüsselter Rest
    d.pages.forEach(p => dropUrl(p.blobId));
  }
}

// ---------- Bilder anzeigen (nur entsperrt, Blob-URLs werden beim Sperren widerrufen) ----------

function dropUrl(blobId) {
  const url = st.urls.get(blobId);
  if (url) { URL.revokeObjectURL(url); st.urls.delete(blobId); }
}

async function pageUrl(page) {
  if (st.ctx.isLocked()) return null;
  let url = st.urls.get(page.blobId);
  if (!url) {
    const bytes = await st.ctx.loadBlob(page.blobId);
    if (!bytes || st.ctx.isLocked()) return null;
    url = URL.createObjectURL(new Blob([bytes], { type: page.mime }));
    st.urls.set(page.blobId, url);
  }
  return url;
}

function pageImg(page, alt) {
  const img = el('img', { class: 'doc-page', alt, width: page.w, height: page.h });
  img.onclick = () => img.classList.toggle('zoom'); // antippen: vergrößern zum Lesen kleiner Schrift
  pageUrl(page)
    .then(url => { if (url) img.src = url; else img.alt = `${alt}: nicht gefunden`; })
    .catch(() => { img.alt = `${alt}: lässt sich nicht entschlüsseln`; });
  return img;
}

// ---------- Scannen ----------

async function storePage(p) {
  const blobId = uuid();
  await st.ctx.saveBlob(blobId, new Uint8Array(await p.blob.arrayBuffer()));
  st.urls.set(blobId, URL.createObjectURL(p.blob)); // Vorschau ohne erneutes Entschlüsseln
  return { blobId, mime: p.mime, w: p.w, h: p.h, bytes: p.bytes };
}

/** Neue Seite verschlüsselt speichern und im angefangenen Scan vermerken; bei Fehler nichts zurücklassen. */
async function commitPage(processed, replaceIndex = -1) {
  const d = draft();
  const page = await storePage(processed);
  const pages = d.pages.slice();
  if (replaceIndex >= 0) pages[replaceIndex] = page; else pages.push(page);
  try {
    await saveDraft({ ...d, pages });
  } catch (err) {
    await st.ctx.removeBlobs([page.blobId]).catch(() => {});
    dropUrl(page.blobId);
    throw err;
  }
}

async function addFiles(files) {
  const ctx = st.ctx;
  if (ctx.isLocked() || !files.length || st.busy) return;
  st.busy = true;
  const status = document.querySelector('#scan-status');
  let added = 0;
  const errors = [];
  try {
    for (const file of files) {
      const d = draft();
      if (!d) break;
      if (d.pages.length >= SCAN_LIMITS.maxPages) { errors.push(`Höchstens ${SCAN_LIMITS.maxPages} Seiten pro Dokument.`); break; }
      if (status) status.textContent = `Seite ${d.pages.length + 1} wird verarbeitet …`;
      try {
        await commitPage(await processImage(file));
        added++;
      } catch (err) {
        errors.push(err.message || 'Seite konnte nicht gespeichert werden.');
      }
    }
  } finally {
    st.busy = false;
  }
  if (ctx.isLocked()) return;
  renderScan();
  if (errors.length) ctx.toast(errors[0]);
  else if (added) ctx.toast(added === 1 ? 'Seite hinzugefügt' : `${added} Seiten hinzugefügt`);
}

async function rotatePage(i) {
  if (st.busy) return;
  st.busy = true;
  try {
    const old = draft().pages[i];
    const bytes = await st.ctx.loadBlob(old.blobId);
    if (!bytes) throw new Error('Seite nicht gefunden.');
    await commitPage(await processImage(new Blob([bytes], { type: old.mime }), { rotate: 90 }), i);
    await st.ctx.removeBlobs([old.blobId]).catch(() => {});
    dropUrl(old.blobId);
  } catch (err) {
    st.ctx.toast(err.message || 'Drehen fehlgeschlagen.');
  } finally {
    st.busy = false;
  }
  if (!st.ctx.isLocked()) renderScan();
}

async function removePage(i) {
  if (st.busy) return;
  const d = draft();
  const [old] = d.pages.splice(i, 1);
  try {
    await saveDraft(d);
    await st.ctx.removeBlobs([old.blobId]).catch(() => {});
    dropUrl(old.blobId);
  } catch (err) {
    st.ctx.toast(err.message || 'Entfernen fehlgeschlagen.');
  }
  renderScan();
}

function renderScan() {
  const d = draft();
  if (!d) return;
  const health = d.area === 'health';
  const camera = el('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'scan-camera', hidden: true });
  const pick = el('input', { type: 'file', accept: 'image/*', multiple: true, id: 'scan-pick', hidden: true });
  for (const input of [camera, pick]) {
    input.onchange = e => {
      const files = [...e.target.files];
      e.target.value = '';
      addFiles(files);
    };
  }
  const full = d.pages.length >= SCAN_LIMITS.maxPages;
  openSheet({
    title: health ? 'Befund scannen' : 'Dokument scannen',
    subtitle: `${pagesText(d.pages.length)} · höchstens ${SCAN_LIMITS.maxPages}`,
    body: [
      el('p', { class: 'muted small', text: 'Blatt für Blatt fotografieren: flach hinlegen, gutes Licht, ganzes Blatt im Bild. Die Fotos werden verkleinert, von Metadaten wie dem Aufnahmeort befreit und verschlüsselt auf diesem Gerät gespeichert. Die App liest keine Werte automatisch aus.' }),
      el('div', { class: 'scan-buttons' },
        el('button', { type: 'button', class: 'primary', id: 'btn-scan-camera', disabled: full, onclick: () => camera.click() }, icon('camera'), 'Seite fotografieren'),
        el('button', { type: 'button', class: 'secondary', id: 'btn-scan-pick', disabled: full, onclick: () => pick.click() }, icon('images'), 'Aus Fotos wählen'),
        camera, pick),
      el('p', { id: 'scan-status', class: 'muted small', role: 'status' }),
      d.pages.length
        ? el('ol', { class: 'scan-pages' }, d.pages.map((p, i) => el('li', { class: 'scan-page' },
          pageImg(p, `Seite ${i + 1}`),
          el('div', { class: 'scan-page-bar' },
            el('span', { class: 'small', text: `Seite ${i + 1}`, title: size(p.bytes) }),
            el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Seite ${i + 1} drehen`, onclick: () => rotatePage(i) }, icon('rotate-cw')),
            el('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Seite ${i + 1} entfernen`, onclick: () => removePage(i) }, icon('trash-2'))))))
        : el('p', { class: 'muted empty', text: 'Noch keine Seite aufgenommen.' }),
    ],
    actions: [
      el('button', { type: 'button', class: 'secondary', id: 'btn-scan-discard', onclick: async () => {
        if (d.pages.length && !confirm('Angefangenen Scan mit allen Seiten verwerfen?')) return;
        await discardDraft();
        st.onSaved = null;
        closeForm();
      } }, 'Verwerfen'),
      el('button', { type: 'button', class: 'primary', id: 'btn-scan-next', disabled: !d.pages.length, onclick: askDetails }, 'Weiter'),
    ],
  });
}

function detailFields(area) {
  const health = area === 'health';
  return [
    { name: 'title', label: 'Titel', required: true, hint: health ? 'z. B. Großes Blutbild' : 'z. B. Kfz-Police 2027' },
    { name: 'kind', label: 'Art', type: 'select', options: KINDS[area] },
    { name: 'docDate', label: health ? 'Datum des Befunds' : 'Datum des Dokuments', type: 'date', required: true },
    { name: 'source', label: health ? 'Labor / Praxis' : 'Absender' },
    { name: 'note', label: 'Notiz', type: 'textarea' },
  ];
}

function askDetails() {
  const d = draft();
  if (!d?.pages.length) return;
  openForm({
    title: d.area === 'health' ? 'Befund speichern' : 'Dokument speichern',
    note: `${pagesText(d.pages.length)}, zusammen ${size(d.pages.reduce((s, p) => s + p.bytes, 0))}. Abbrechen behält den angefangenen Scan.`,
    fields: detailFields(d.area),
    values: { docDate: st.ctx.today() },
    onSave: async data => {
      const current = draft(); // Stand direkt vor dem Speichern
      if (!current?.pages.length) throw new Error('Der Scan enthält keine Seiten mehr.');
      const doc = await st.ctx.save({ id: uuid(), module: 'document', area: current.area, linkedId: current.linkedId, ...data, pages: current.pages });
      await saveDraft({ area: null, linkedId: null, pages: [] }).catch(() => {}); // Seiten gehören jetzt zum Dokument (siehe draft())
      st.ctx.toast(current.area === 'health' ? 'Befund gespeichert' : 'Dokument gespeichert');
      const cb = st.onSaved || afterSaveByArea[current.area];
      st.onSaved = null;
      if (cb) setTimeout(() => cb(doc, st.ctx), 0);
    },
  });
}

/**
 * Scan beginnen oder einen angefangenen fortsetzen.
 * area: 'health' | 'contracts'; linkedId: Vertrag, dem das Dokument zugeordnet wird; onSaved(doc) nach dem Speichern.
 */
export async function startScan({ area, linkedId = null, onSaved = null }) {
  const d = draft();
  if (d?.pages.length && (d.area !== area || d.linkedId !== linkedId)) {
    if (!confirm(`Es gibt einen angefangenen Scan mit ${pagesText(d.pages.length)}. Verwerfen und neu beginnen?\n\n„Abbrechen“ setzt den angefangenen Scan fort.`)) {
      st.onSaved = null;
      renderScan();
      return;
    }
    await discardDraft();
  }
  if (!draft()?.pages.length) await saveDraft({ area, linkedId, pages: [] });
  st.onSaved = onSaved;
  renderScan();
}

/** Nach dem Entsperren: angefangenen Scan (z. B. nach einem Neustart der App durch die Kamera) wieder öffnen. */
export function resumeDraft() {
  const d = draft();
  if (!d?.pages.length) return false;
  st.ctx.toast(`Angefangener Scan mit ${pagesText(d.pages.length)} wiederhergestellt.`);
  renderScan();
  return true;
}

// ---------- Ansehen, bearbeiten, löschen ----------

function fact(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return el('div', { class: 'fact' }, el('dt', { text: label }), el('dd', { text: String(value) }));
}

/** actions: zusätzliche Schaltflächen des aufrufenden Bereichs (z. B. „Laborwert eintragen“). */
export function openDocument(id, { actions = [] } = {}) {
  const ctx = st.ctx;
  const doc = ctx.records.find(r => r.id === id && r.module === 'document');
  if (!doc) return;
  const health = doc.area === 'health';
  const labs = health ? ctx.records.filter(r => r.module === 'lab' && r.docId === doc.id) : [];
  const total = doc.pages.reduce((s, p) => s + p.bytes, 0);
  openSheet({
    title: doc.title,
    subtitle: [doc.kind, formatDE(doc.docDate)].filter(Boolean).join(' · '),
    body: [
      el('dl', { class: 'facts' },
        fact(health ? 'Labor / Praxis' : 'Absender', doc.source),
        fact('Seiten', `${doc.pages.length} (${size(total)})`),
        fact('Notiz', doc.note)),
      labs.length ? el('section', {},
        el('h3', {}, icon('heart-pulse'), 'Daraus eingetragene Werte'),
        el('ul', { class: 'plain-list' }, labs.map(l => el('li', { text: `${l.parameter}: ${num.format(l.value)}${l.unit ? ` ${l.unit}` : ''}` })))) : null,
      el('p', { class: 'muted small', text: 'Seite antippen, um sie zu vergrößern.' }),
      el('div', { class: 'doc-pages' }, doc.pages.map((p, i) => el('figure', { class: 'doc-figure' },
        pageImg(p, `Seite ${i + 1} von ${doc.pages.length}`),
        el('figcaption', { class: 'muted small', text: `Seite ${i + 1} von ${doc.pages.length}` })))),
    ],
    actions: [
      el('button', { type: 'button', class: 'secondary', id: 'btn-doc-edit', onclick: () => editDocument(doc, actions) }, icon('pencil'), 'Bearbeiten'),
      el('button', { type: 'button', class: 'danger', id: 'btn-doc-delete', onclick: () => deleteDocument(doc) }, icon('trash-2'), 'Löschen'),
      ...actions,
    ],
  });
}

function editDocument(doc, actions) {
  openForm({
    title: doc.area === 'health' ? 'Befund bearbeiten' : 'Dokument bearbeiten',
    fields: detailFields(doc.area),
    values: doc,
    onSave: async data => {
      await st.ctx.save({ ...doc, ...data });
      setTimeout(() => openDocument(doc.id, { actions }), 0);
    },
  });
}

async function deleteDocument(doc) {
  const labs = st.ctx.records.filter(r => r.module === 'lab' && r.docId === doc.id);
  if (!confirm(`„${doc.title}“ mit ${pagesText(doc.pages.length)} endgültig löschen?${labs.length ? ' Eingetragene Werte bleiben erhalten.' : ''}`)) return;
  try {
    for (const l of labs) await st.ctx.save({ ...l, docId: null }, { silent: true });
    await st.ctx.remove(doc, doc.pages.map(p => p.blobId));
  } catch (err) {
    st.ctx.toast(err.message || 'Löschen fehlgeschlagen.');
    return;
  }
  doc.pages.forEach(p => dropUrl(p.blobId));
  closeForm();
}

/** Alle Dokumente eines Vertrags löschen (beim Löschen des Vertrags). */
export async function removeLinked(linkedId) {
  for (const doc of st.ctx.records.filter(r => r.module === 'document' && r.linkedId === linkedId)) {
    await st.ctx.remove(doc, doc.pages.map(p => p.blobId));
    doc.pages.forEach(p => dropUrl(p.blobId));
  }
}

/** Seiten als scrollbarer Streifen, z. B. über dem Formular beim Abtippen eines Laborwerts. */
export function pageStrip(doc) {
  return el('div', { class: 'doc-strip' }, doc.pages.map((p, i) => pageImg(p, `Seite ${i + 1} von ${doc.pages.length}`)));
}

/** Liste zum Einbetten in Gesundheit und Vertragsdetails. */
export function docList(docs, onOpen) {
  return el('ul', { class: 'doc-list' }, docs.map(d => el('li', {},
    el('button', { type: 'button', class: 'doc-item', onclick: () => onOpen(d.id) },
      icon('file-text'),
      el('span', { class: 'doc-text' },
        el('span', { class: 'doc-title', text: d.title }),
        el('span', { class: 'muted small', text: [d.kind, formatDE(d.docDate), pagesText(d.pages.length)].filter(Boolean).join(' · ') })),
      icon('chevron-right')))));
}

// ---------- Lebenszyklus ----------

export function init(ctx) {
  st.ctx = ctx;
}

/** Beim Sperren: entschlüsselte Bilder widerrufen, laufende Vorgänge vergessen. */
export function onLock() {
  st.urls.forEach(url => URL.revokeObjectURL(url));
  st.urls.clear();
  st.onSaved = null;
  st.busy = false;
}
