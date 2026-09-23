// M1 – Tagebuch mit Text- und Sprachnotizen (module: 'diary'), siehe docs/features/tagebuch.md.
//
// Datensatz: { id, module: 'diary', createdAt, updatedAt, occurredAt, tz, title, text, tags[], mood,
//              audio: { blobId, mime, durationSec } | null }
// occurredAt/tz beschreiben, WANN das Erlebte war (rückdatierbar); createdAt bleibt der echte Erstellungszeitpunkt.

import { AUDIO_MAX_SECONDS } from '../config.js';
import { el, icon } from '../ui/dom.js';
import { localDateIn, inDateRange, formatDE } from '../lib/dates.js';
import { questionFor } from '../lib/impulses.js';
import { impulseCard } from './overview.js';
import { openForm, openSheet, closeForm } from '../ui/form.js';
import * as asr from '../lib/transcribe.js';

const MOODS = ['sehr gut', 'gut', 'neutral', 'schlecht', 'sehr schlecht'];
const $ = sel => document.querySelector(sel);

const st = {
  ctx: null,
  recorder: null,      // { rec, stream, chunks, started, tick, cancelled }
  pending: null,       // aufgenommene, noch nicht gespeicherte Aufnahme { blob, url, durationSec, mime }
  replaceFor: null,    // ID des Eintrags, dessen Sprachnotiz die nächste Aufnahme ersetzt (oder ergänzt)
  audioUrls: new Map(),
  tag: null,
  from: null, // Zeitraumfilter (Kalendertage, einschließlich), null = offen
  to: null,
  draftTimer: null,
  asrInfoShown: false, // Hinweis „läuft nur auf diesem Handy“ einmal je Sitzung
  asrRun: 0,           // laufende Umwandlung; abgebrochene Läufe werden verworfen
};

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
const uuid = () => crypto.randomUUID();
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const occurred = e => e.occurredAt || e.createdAt;
export const tzOf = e => e.tz || localTz();

function fmt(e, opts) {
  try {
    return new Intl.DateTimeFormat('de-DE', { ...opts, timeZone: tzOf(e) }).format(new Date(occurred(e)));
  } catch {
    return new Intl.DateTimeFormat('de-DE', opts).format(new Date(occurred(e)));
  }
}
const dayLabel = e => fmt(e, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
/** Kalendertag des Eintrags in seiner eigenen Zeitzone ('YYYY-MM-DD'), Grundlage für Tagesansicht und Zeitraumfilter. */
export const dayOf = e => localDateIn(occurred(e), tzOf(e));
const timeLabel = e => fmt(e, { hour: '2-digit', minute: '2-digit' });

export function parseTags(raw) {
  return [...new Set(String(raw || '').split(/[,;]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean).map(t => t.slice(0, 40)))].slice(0, 12);
}

// ---------- Anlegen / Bearbeiten ----------

async function addEntry({ text = '', title = null, tags = [], mood = null, audio = null, occurredAt = null }) {
  const ctx = st.ctx;
  const now = new Date().toISOString();
  const entry = { id: uuid(), module: 'diary', createdAt: now, occurredAt: occurredAt || now, tz: localTz(), title, text, tags, mood, audio: null };
  if (audio) {
    const blobId = uuid();
    await ctx.saveBlob(blobId, new Uint8Array(await audio.blob.arrayBuffer()));
    entry.audio = { blobId, mime: audio.blob.type || audio.mime, durationSec: audio.durationSec };
  }
  await ctx.save(entry);
  return entry;
}

function dateTimeParts(e) {
  const d = new Date(occurred(e));
  const pad = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function entryFields(existingTags, withAudio) {
  return [
    { name: 'title', label: 'Titel (optional)' },
    { name: 'text', label: 'Text', type: 'textarea' },
    { name: 'tags', label: 'Tags (mit Komma trennen)', suggest: existingTags, hint: 'z. B. Familie, Arbeit, Sport' },
    { name: 'mood', label: 'Stimmung (optional)', type: 'select', options: [{ value: '', label: '–' }, ...MOODS.map(m => ({ value: m, label: m }))] },
    { name: 'date', label: 'Datum des Erlebten', type: 'date', required: true, inline: true },
    { name: 'time', label: 'Uhrzeit', type: 'time', required: true, inline: true },
    withAudio === null ? null : { name: 'audio', label: 'Sprachnotiz', type: 'select', options: withAudio
      ? [{ value: 'keep', label: 'behalten' }, { value: 'replace', label: 'neu aufnehmen (ersetzt die bisherige)' }, { value: 'remove', label: 'entfernen' }]
      : [{ value: 'none', label: 'keine' }, { value: 'replace', label: 'jetzt aufnehmen und anhängen' }] },
  ].filter(Boolean);
}

const allTags = () => [...new Set(st.ctx.records.filter(r => r.module === 'diary').flatMap(r => r.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));

function toOccurred(date, time) {
  const d = new Date(`${date}T${time || '00:00'}`);
  if (Number.isNaN(d.getTime())) throw new Error('Datum oder Uhrzeit ist ungültig.');
  return d.toISOString();
}

export function editEntry(entry, preset = {}) {
  const ctx = st.ctx;
  const parts = entry ? dateTimeParts(entry) : dateTimeParts({ createdAt: new Date().toISOString() });
  openForm({
    title: entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    fields: entryFields(allTags(), entry ? !!entry.audio : null),
    values: entry
      ? { title: entry.title, text: entry.text, tags: (entry.tags || []).join(', '), mood: entry.mood || '', ...parts, audio: entry.audio ? 'keep' : 'none' }
      : { text: $('#entry-text').value, ...parts, ...preset },
    note: entry ? `Erstellt am ${new Date(entry.createdAt).toLocaleString('de-DE')}. Dieser Zeitpunkt bleibt erhalten.` : null,
    onSave: async data => {
      if (!data.text && !data.title && !entry?.audio) throw new Error('Bitte einen Text oder Titel eingeben.');
      const fields = { title: data.title, text: data.text || '', tags: parseTags(data.tags), mood: data.mood || null, occurredAt: toOccurred(data.date, data.time) };
      if (entry) {
        const next = { ...entry, ...fields, tz: entry.tz || localTz() };
        if (entry.audio && data.audio === 'remove') {
          next.audio = null;
          await ctx.save(next);
          await ctx.removeBlobs([entry.audio.blobId]);
          revoke(entry.id);
        } else {
          await ctx.save(next);
        }
        if (data.audio === 'replace') {
          if (st.recorder || st.pending) { ctx.toast('Eintrag gespeichert. Bitte zuerst die laufende Aufnahme speichern oder verwerfen.'); return; }
          st.replaceFor = entry.id;
          setTimeout(startRecording, 0); // nach dem Schließen des Formulars
          return;
        }
        ctx.toast('Eintrag gespeichert');
      } else {
        await addEntry(fields);
        $('#entry-text').value = '';
        await clearDraft();
        ctx.toast('Eintrag gespeichert');
      }
    },
    onDelete: entry ? () => removeEntry(entry, { confirmed: true }) : null,
  });
}

async function removeEntry(entry, { confirmed = false } = {}) {
  if (!confirmed && !confirm('Diesen Eintrag endgültig löschen?')) return;
  await st.ctx.remove(entry, entry.audio ? [entry.audio.blobId] : []);
  revoke(entry.id);
}

// ---------- Entwurf (verschlüsselt im Tresor) ----------

function scheduleDraft() {
  clearTimeout(st.draftTimer);
  st.draftTimer = setTimeout(async () => {
    if (st.ctx.isLocked()) return;
    const text = $('#entry-text').value;
    const current = st.ctx.getConfig('draft');
    if ((current?.text || '') === text) return;
    await st.ctx.saveConfig('draft', { text }, { silent: true }).catch(() => {}); // Entwurf ist Komfort, kein Muss
  }, 800);
}

/** Entwurf sofort sichern (vor einem Update), statt auf den Zeitgeber zu warten. */
export async function flushDraft() {
  clearTimeout(st.draftTimer);
  if (st.ctx.isLocked()) return;
  const text = $('#entry-text').value;
  if ((st.ctx.getConfig('draft')?.text || '') === text) return;
  await st.ctx.saveConfig('draft', { text }, { silent: true }).catch(() => {});
}

async function clearDraft() {
  clearTimeout(st.draftTimer);
  if (st.ctx.getConfig('draft')?.text) await st.ctx.saveConfig('draft', { text: '' }, { silent: true });
}

export function restoreDraft() {
  const draft = st.ctx.getConfig('draft');
  if (draft?.text && !$('#entry-text').value) {
    $('#entry-text').value = draft.text;
    return true;
  }
  return false;
}

async function onSaveText(e) {
  e.preventDefault();
  const text = $('#entry-text').value.trim();
  if (!text) return;
  try {
    await addEntry({ text });
  } catch (err) {
    st.ctx.toast(err.message || 'Speichern fehlgeschlagen.'); // Text bleibt im Eingabefeld erhalten
    return;
  }
  $('#entry-text').value = '';
  await clearDraft().catch(() => {});
  st.ctx.toast('Eintrag gespeichert');
  offerReflection();
}

/** Reflexionshilfe (R05): nur wenn eingeschaltet, eine Frage nach dem Speichern; wertet keine Einträge aus. */
function offerReflection() {
  if (!st.ctx.prefs().reflection) return;
  const today = st.ctx.today();
  const q = questionFor(today, st.reflectionSeed = (st.reflectionSeed || 0) + 1);
  openSheet({
    title: 'Zum Weiterdenken',
    subtitle: 'freiwillig',
    body: [el('p', { class: 'reflection-question', text: q })],
    actions: [
      el('button', { type: 'button', class: 'secondary', id: 'btn-reflection-skip', onclick: () => closeForm() }, 'Überspringen'),
      el('button', { type: 'button', class: 'primary', id: 'btn-reflection-answer', onclick: () => { closeForm(); editEntry(null, { title: q }); } }, 'Beantworten'),
    ],
  });
}

// ---------- Sprachaufnahme ----------

function pickMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

function renderRecordControls() {
  const box = $('#rec-controls');
  const status = $('#rec-status');
  if (st.recorder) {
    box.replaceChildren(
      el('button', { type: 'button', class: 'secondary recording', id: 'btn-rec-stop', onclick: () => stopRecording(false) }, icon('square'), 'Stopp'),
      el('button', { type: 'button', class: 'secondary', id: 'btn-rec-cancel', onclick: () => stopRecording(true) }, icon('x'), 'Abbrechen'));
    return;
  }
  status.textContent = st.replaceFor ? 'Neue Aufnahme für einen bestehenden Eintrag' : '';
  box.replaceChildren(el('button', { type: 'button', class: 'secondary', id: 'btn-record', onclick: startRecording },
    icon('mic'), el('span', { text: 'Aufnahme' })));
}

async function startRecording() {
  const ctx = st.ctx;
  if (st.pending) discardPending();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    ctx.toast('Sprachaufnahme wird von diesem Browser nicht unterstützt. Textnotizen funktionieren weiterhin.');
    st.replaceFor = null;
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // Berechtigung erst jetzt
  } catch {
    ctx.toast('Kein Zugriff auf das Mikrofon. Textnotizen funktionieren weiterhin.');
    st.replaceFor = null;
    return;
  }
  const mime = pickMime();
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch {
    stream.getTracks().forEach(t => t.stop());
    ctx.toast('Aufnahme konnte nicht gestartet werden.');
    st.replaceFor = null;
    return;
  }
  const r = { rec, stream, chunks: [], started: Date.now(), cancelled: false, tick: null };
  r.tick = setInterval(() => {
    const s = Math.floor((Date.now() - r.started) / 1000);
    $('#rec-status').textContent = `${mmss(s)} / ${mmss(AUDIO_MAX_SECONDS)}`;
    if (s >= AUDIO_MAX_SECONDS) stopRecording(false, 'Maximale Länge von 5 Minuten erreicht.');
  }, 250);
  rec.ondataavailable = ev => { if (ev.data.size) r.chunks.push(ev.data); };
  rec.onstop = () => onRecorderStopped(r, mime);
  rec.onerror = () => stopRecording(true, 'Die Aufnahme wurde unterbrochen.');
  st.recorder = r;
  rec.start(1000);
  renderRecordControls();
}

function stopRecording(cancel, message) {
  const r = st.recorder;
  if (!r) return;
  r.cancelled = cancel;
  clearInterval(r.tick);
  if (message) st.ctx.toast(message);
  if (r.rec.state !== 'inactive') r.rec.stop(); else onRecorderStopped(r, '');
}

function onRecorderStopped(r, mime) {
  if (r.done) return;
  r.done = true;
  clearInterval(r.tick);
  r.stream.getTracks().forEach(t => t.stop()); // Mikrofon sichtbar beenden
  st.recorder = null;
  renderRecordControls();
  if (r.cancelled || !r.chunks.length || st.ctx.isLocked()) { st.replaceFor = null; return; }
  const type = r.rec.mimeType || mime || 'audio/webm';
  const blob = new Blob(r.chunks, { type });
  st.pending = { blob, url: URL.createObjectURL(blob), durationSec: Math.max(1, Math.round((Date.now() - r.started) / 1000)), mime: type };
  renderReview();
}

function renderReview() {
  const box = $('#rec-review');
  if (!st.pending) { box.replaceChildren(); box.hidden = true; return; }
  const audio = el('audio', { controls: true });
  audio.src = st.pending.url;
  box.hidden = false;
  box.replaceChildren(
    el('p', { class: 'small muted', text: target()
      ? `Aufnahme (${mmss(st.pending.durationSec)}) für den Eintrag vom ${dayLabel(target())}, ${timeLabel(target())} Uhr. Beim Speichern ${target().audio ? 'ersetzt sie die bisherige Sprachnotiz' : 'wird sie angehängt'}.`
      : `Aufnahme (${mmss(st.pending.durationSec)}). Anhören, dann speichern. Ein eingegebener Text wird mitgespeichert.` }),
    audio,
    el('div', { class: 'review-actions' },
      el('button', { type: 'button', class: 'secondary', onclick: () => { st.replaceFor = null; discardPending(); } }, icon('trash-2'), 'Verwerfen'),
      el('button', { type: 'button', class: 'secondary', onclick: () => { discardPending(); startRecording(); } }, icon('mic'), 'Neu aufnehmen'),
      target() ? null : el('button', { type: 'button', class: 'secondary', id: 'btn-transcribe-pending', onclick: transcribePending }, icon('file-text'), 'In Text umwandeln'),
      el('button', { type: 'button', class: 'primary', id: 'btn-save-audio', onclick: savePending }, 'Speichern')));
}

// ---------- In Text umwandeln (lokal, ADR-0008) ----------

/**
 * Wandelt eine Aufnahme auf dem Gerät in Text um und zeigt das Ergebnis bearbeitbar an.
 * onApply(text) wird erst nach „Übernehmen“ aufgerufen; vorher wird nichts gespeichert.
 */
async function transcribeAudio(blob, { onApply, applyLabel }) {
  if (!st.asrInfoShown) {
    const ok = confirm('Die Umwandlung in Text läuft nur auf diesem Handy. Die Aufnahme wird nicht hochgeladen.\n\nDer erkannte Text ist ein Vorschlag: Du kannst ihn ändern, bevor er gespeichert wird.');
    if (!ok) return;
    st.asrInfoShown = true;
  }
  const run = ++st.asrRun;
  const status = el('p', { class: 'ocr-status', role: 'status', text: 'Wird vorbereitet …' });
  const bar = el('progress', { class: 'ocr-progress', max: '100' }); // ohne value: läuft, Dauer unbekannt
  const cancel = () => { st.asrRun++; asr.stop(); closeForm(); };
  openSheet({
    title: 'Sprachnotiz wird umgewandelt',
    subtitle: 'nur auf diesem Gerät',
    body: [status, bar, el('p', { class: 'muted small', text: 'Das dauert etwa so lange wie die Aufnahme, beim ersten Mal länger. Undeutliche Stellen werden oft falsch erkannt.' })],
    actions: [el('button', { type: 'button', class: 'secondary', id: 'btn-transcribe-cancel', onclick: cancel }, 'Abbrechen')],
  });
  const dlg = document.getElementById('editor');
  const onClose = () => { if (run === st.asrRun) cancel(); }; // Schließen (X, Esc) bricht ebenfalls ab
  dlg.addEventListener('close', onClose, { once: true });
  let text;
  try {
    text = await asr.transcribe(blob, {
      onProgress: p => {
        if (run !== st.asrRun) return;
        if (p.phase === 'load') { status.textContent = 'Erkennungsdaten werden geladen …'; bar.value = String(Math.round((p.progress || 0) * 100)); }
        else { status.textContent = 'Sprache wird erkannt …'; bar.removeAttribute('value'); }
      },
    });
  } catch (err) {
    if (run !== st.asrRun || err.name === 'AbortError') return;
    dlg.removeEventListener('close', onClose);
    st.asrRun++;
    asr.stop();
    closeForm();
    st.ctx.toast(`Umwandlung fehlgeschlagen: ${err.message || err}`);
    return;
  }
  dlg.removeEventListener('close', onClose);
  if (run !== st.asrRun || st.ctx.isLocked()) return;
  st.asrRun++;
  asr.stop(); // Modell nicht im Speicher halten; das nächste Mal lädt es aus dem Offline-Speicher
  const area = el('textarea', { id: 'transcript-text', rows: '6', 'aria-label': 'Erkannter Text' });
  area.value = text;
  openSheet({
    title: 'Erkannter Text',
    subtitle: 'bitte prüfen und bei Bedarf ändern',
    body: [
      text ? null : el('p', { class: 'muted', text: 'Es wurde keine Sprache erkannt. Du kannst den Text selbst eingeben.' }),
      area,
    ],
    actions: [
      el('button', { type: 'button', class: 'secondary', onclick: closeForm }, 'Verwerfen'),
      el('button', { type: 'button', class: 'primary', id: 'btn-transcript-apply', onclick: async () => {
        const t = area.value.trim();
        if (!t) { closeForm(); return; }
        try {
          await onApply(t);
          closeForm();
        } catch (err) {
          st.ctx.toast(err.message || 'Speichern fehlgeschlagen.');
        }
      } }, applyLabel),
    ],
  });
  area.focus();
}

const appendText = (base, add) => (base ? `${base.replace(/\s+$/, '')}\n\n${add}` : add);

/** Neue Aufnahme: Text ins Eingabefeld übernehmen, gespeichert wird mit „Speichern“. */
function transcribePending() {
  const p = st.pending;
  if (!p) return;
  transcribeAudio(p.blob, {
    applyLabel: 'In das Textfeld übernehmen',
    onApply: async t => {
      const box = $('#entry-text');
      box.value = appendText(box.value.trim(), t);
      scheduleDraft();
      st.ctx.toast('Text übernommen. Mit „Speichern“ wird beides gespeichert.');
    },
  });
}

/** Bestehender Eintrag: Text anhängen und speichern (verschlüsselt wie jeder Eintragstext). */
async function transcribeEntry(entry) {
  const bytes = await st.ctx.loadBlob(entry.audio.blobId);
  if (!bytes) { st.ctx.toast('Aufnahme nicht gefunden.'); return; }
  transcribeAudio(new Blob([bytes], { type: entry.audio.mime }), {
    applyLabel: 'Zum Eintrag hinzufügen',
    onApply: async t => {
      const current = st.ctx.records.find(r => r.id === entry.id) || entry;
      await st.ctx.save({ ...current, text: appendText(current.text || '', t) });
      st.ctx.toast('Text zum Eintrag hinzugefügt');
    },
  });
}

const target = () => st.replaceFor && st.ctx.records.find(r => r.id === st.replaceFor && r.module === 'diary');

/** Neue Aufnahme an einen bestehenden Eintrag hängen. Reihenfolge: neue Aufnahme speichern, Eintrag umstellen, alte löschen. */
async function replaceAudio(entry, p) {
  const ctx = st.ctx;
  const blobId = uuid();
  await ctx.saveBlob(blobId, new Uint8Array(await p.blob.arrayBuffer()));
  try {
    await ctx.save({ ...entry, audio: { blobId, mime: p.blob.type || p.mime, durationSec: p.durationSec } });
  } catch (err) {
    await ctx.removeBlobs([blobId]).catch(() => {});
    throw err;
  }
  if (entry.audio) await ctx.removeBlobs([entry.audio.blobId]).catch(() => {}); // schlimmstenfalls bleibt eine verwaiste, verschlüsselte Aufnahme
  revoke(entry.id);
}

async function savePending() {
  const p = st.pending;
  if (!p) return;
  const entry = target();
  if (entry) {
    try {
      await replaceAudio(entry, p);
    } catch (err) {
      st.ctx.toast(err.message || 'Speichern fehlgeschlagen.');
      return;
    }
    st.replaceFor = null;
    discardPending();
    renderRecordControls();
    st.ctx.toast(entry.audio ? 'Sprachnotiz ersetzt' : 'Sprachnotiz angehängt');
    return;
  }
  st.replaceFor = null;
  const text = $('#entry-text').value.trim();
  try {
    await addEntry({ text, audio: p });
  } catch (err) {
    st.ctx.toast(err.message || 'Speichern fehlgeschlagen.'); // Aufnahme bleibt zum erneuten Versuch erhalten
    return;
  }
  discardPending();
  $('#entry-text').value = '';
  await clearDraft().catch(() => {});
  st.ctx.toast('Sprachnotiz gespeichert');
  offerReflection(); // wie bei Textnotizen, nur wenn eingeschaltet
}

function discardPending() {
  if (st.pending) URL.revokeObjectURL(st.pending.url);
  st.pending = null;
  renderReview();
}

async function playAudio(entry, container) {
  let url = st.audioUrls.get(entry.id);
  if (!url) {
    const bytes = await st.ctx.loadBlob(entry.audio.blobId);
    if (!bytes) { st.ctx.toast('Aufnahme nicht gefunden.'); return; }
    url = URL.createObjectURL(new Blob([bytes], { type: entry.audio.mime }));
    st.audioUrls.set(entry.id, url);
  }
  const audio = el('audio', { controls: true });
  audio.src = url;
  container.replaceChildren(audio);
  audio.play().catch(() => {});
}

function revoke(id) {
  const url = st.audioUrls.get(id);
  if (url) { URL.revokeObjectURL(url); st.audioUrls.delete(id); }
}

// ---------- Liste ----------

export function render() {
  const ctx = st.ctx;
  const q = $('#search').value.trim().toLowerCase();
  const diary = ctx.records.filter(e => e.module === 'diary');
  const tags = allTags();
  if (st.tag && !tags.includes(st.tag)) st.tag = null;

  $('#tag-filter').replaceChildren(...(tags.length ? [
    el('button', { class: `tag-chip${st.tag ? '' : ' active'}`, onclick: () => { st.tag = null; render(); } }, 'Alle'),
    ...tags.map(t => el('button', { class: `tag-chip${st.tag === t ? ' active' : ''}`, onclick: () => { st.tag = st.tag === t ? null : t; render(); } }, `#${t}`)),
  ] : []));

  $('#range-from').value = st.from || '';
  $('#range-to').value = st.to || '';
  const ranged = !!(st.from || st.to);
  $('#range-reset').hidden = !ranged;

  const list = diary
    .filter(e => !st.tag || (e.tags || []).includes(st.tag))
    .filter(e => !ranged || inDateRange(dayOf(e), st.from, st.to))
    .filter(e => !q || [e.title, e.text, ...(e.tags || [])].some(v => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => occurred(b).localeCompare(occurred(a)));

  const root = $('#entries');
  const impulse = impulseCard(st.ctx, render, 'diary-'); // nur wenn eingeschaltet
  if (!list.length) {
    const rangeText = ranged ? ` im Zeitraum ${rangeLabel()}` : '';
    root.replaceChildren(...[impulse, el('p', { class: 'muted empty', text: q || st.tag || ranged ? `Keine Treffer${rangeText}.` : 'Noch keine Einträge. Schreib etwas oder starte eine Aufnahme.' })].filter(Boolean));
    return;
  }
  const nodes = impulse ? [impulse] : [];
  let lastDay = '';
  for (const entry of list) {
    const day = dayLabel(entry);
    if (day !== lastDay) {
      const iso = dayOf(entry);
      const single = st.from === iso && st.to === iso;
      nodes.push(el('h2', { class: 'day' }, single ? day : el('button', {
        type: 'button', class: 'day-link', 'aria-label': `Nur ${day} anzeigen`,
        onclick: () => { st.from = iso; st.to = iso; render(); $('#tab-diary').scrollIntoView?.({ block: 'start' }); },
      }, day)));
      lastDay = day;
    }
    const backdated = entry.occurredAt && entry.occurredAt.slice(0, 10) !== entry.createdAt.slice(0, 10);
    const box = entry.audio ? el('div', { class: 'audio-box' },
      el('div', { class: 'audio-player' },
        el('button', { class: 'secondary small', onclick: e => playAudio(entry, e.currentTarget.parentElement) }, icon('play'), `Sprachnotiz (${mmss(entry.audio.durationSec)})`)),
      el('button', { class: 'secondary small btn-transcribe', onclick: () => transcribeEntry(entry) }, icon('file-text'), 'In Text umwandeln')) : null;
    nodes.push(el('article', { class: 'entry diary-entry' },
      el('div', { class: 'entry-meta' },
        el('time', { datetime: occurred(entry), text: `${timeLabel(entry)} Uhr${backdated ? ' · nachgetragen' : ''}` }),
        el('span', { class: 'entry-actions' },
          el('button', { class: 'icon-btn small', 'aria-label': 'Eintrag bearbeiten', onclick: () => editEntry(entry) }, icon('pencil')),
          el('button', { class: 'icon-btn small', 'aria-label': 'Eintrag löschen', onclick: () => removeEntry(entry) }, icon('trash-2')))),
      entry.title ? el('h3', { class: 'entry-title', text: entry.title }) : null,
      entry.text ? el('p', { class: 'entry-text', text: entry.text }) : null,
      box,
      (entry.tags?.length || entry.mood) ? el('div', { class: 'entry-tags' },
        entry.mood ? el('span', { class: 'mood', text: `Stimmung: ${entry.mood}` }) : null,
        ...(entry.tags || []).map(t => el('button', { class: 'tag-chip small', onclick: () => { st.tag = t; render(); } }, `#${t}`))) : null));
  }
  root.replaceChildren(...nodes);
}

function rangeLabel() {
  if (st.from && st.to) return st.from === st.to ? formatDE(st.from) : `${formatDE(st.from < st.to ? st.from : st.to)} – ${formatDE(st.from < st.to ? st.to : st.from)}`;
  return st.from ? `ab ${formatDE(st.from)}` : `bis ${formatDE(st.to)}`;
}

// ---------- Lebenszyklus ----------

export function init(ctx) {
  st.ctx = ctx;
  $('#form-entry').addEventListener('submit', onSaveText);
  $('#entry-text').addEventListener('input', scheduleDraft);
  $('#search').addEventListener('input', render);
  $('#range-from').addEventListener('change', e => { st.from = e.target.value || null; render(); });
  $('#range-to').addEventListener('change', e => { st.to = e.target.value || null; render(); });
  $('#range-reset').addEventListener('click', () => { st.from = null; st.to = null; render(); });
  $('#btn-more').addEventListener('click', () => editEntry(null));
  renderRecordControls();
}

export const isRecording = () => !!st.recorder;
export const startRecordingFromOverview = () => startRecording();

/** Beim Sperren: Aufnahme verwerfen, Mikrofon beenden, Blob-URLs widerrufen, Anzeige leeren. */
export function onLock() {
  st.replaceFor = null;
  st.asrRun++;
  asr.stop(); // Modell und erkannter Text verschwinden aus dem Arbeitsspeicher
  if (st.recorder) stopRecording(true);
  discardPending();
  clearTimeout(st.draftTimer);
  st.audioUrls.forEach(url => URL.revokeObjectURL(url));
  st.audioUrls.clear();
  st.tag = null;
  st.from = null;
  st.to = null;
  $('#entries').replaceChildren();
  $('#tag-filter').replaceChildren();
  $('#entry-text').value = '';
  $('#search').value = '';
}
