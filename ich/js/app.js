// Steuerung der App: Ansichten, Sperren/Entsperren, Modul-Schnittstelle (ctx), Einstellungen.

import { APP_NAME, APP_VERSION } from './config.js';
import * as store from './store.js';
import * as vault from './vault.js';
import { todayISO, formatDE } from './lib/dates.js';
import { closeForm } from './ui/form.js';
import { icon } from './ui/dom.js';
import * as diary from './modules/diary.js';
import * as contracts from './modules/contracts.js';
import * as health from './modules/health.js';
import * as overview from './modules/overview.js';
import * as security from './modules/security.js';
import * as documents from './modules/documents.js';
import * as more from './modules/more.js';

export { APP_VERSION };

const $ = sel => document.querySelector(sel);
const state = {
  key: null,          // CryptoKey des Tresors, nur im Arbeitsspeicher
  records: [],        // entschlüsselte Datensätze aller Module (nur solange entsperrt)
  lockTimer: null,
  lastActivity: Date.now(),
};
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('ich-vault') : null;

// ---------- Hilfsfunktionen ----------

function show(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Nur Darstellungs-Einstellungen und Zeitstempel, keine Inhalte (siehe docs/SECURITY.md)
function prefs() {
  try { return JSON.parse(localStorage.getItem('ich-prefs')) || {}; } catch { return {}; }
}
function setPref(k, v) {
  try { localStorage.setItem('ich-prefs', JSON.stringify({ ...prefs(), [k]: v })); } catch { /* optional */ }
}

const uuid = () => crypto.randomUUID();
const broadcast = type => { try { channel?.postMessage({ type }); } catch { /* optional */ } };

// ---------- Modul-Schnittstelle ----------

const ctx = {
  get records() { return state.records; },
  key: () => state.key,
  today: () => todayISO(),
  toast,
  isLocked: () => !state.key,
  async save(record, { silent = false } = {}) {
    if (!state.key) throw new Error('Tresor ist gesperrt.');
    const now = new Date().toISOString();
    const rec = { ...record, id: record.id || uuid(), createdAt: record.createdAt || now, updatedAt: now };
    await store.saveRecord(state.key, rec); // wirft bei Fehler (z. B. Speicher voll) -> keine Erfolgsmeldung
    const i = state.records.findIndex(r => r.id === rec.id);
    if (i >= 0) state.records[i] = rec; else state.records.push(rec);
    broadcast('changed');
    if (!silent) renderAll();
    return rec;
  },
  async remove(record, blobIds = []) {
    await store.deleteRecord(record.id, blobIds);
    state.records = state.records.filter(r => r.id !== record.id);
    broadcast('changed');
    toast('Eintrag gelöscht');
    renderAll();
  },
  saveBlob: (id, bytes) => store.saveBlob(state.key, id, bytes),
  loadBlob: id => store.loadBlob(state.key, id),
  removeBlobs: ids => store.deleteBlobs(ids),
  showTab: tab => showTab(tab),
  newDiaryEntry() {
    closeForm();
    showTab('diary');
    $('#entry-text').focus();
  },
  startRecording() {
    closeForm();
    showTab('diary');
    diary.startRecordingFromOverview();
  },
  getConfig: name => state.records.find(r => r.id === `config-${name}`) || null,
  saveConfig: (name, data, opts) => ctx.save({ ...data, id: `config-${name}`, module: 'config' }, opts),
  backupStatus: () => security.backupStatus(),
  backupStatusText: () => security.backupStatusText(),
  openSettings(section) {
    closeForm();
    renderSettings();
    show('settings');
    window.scrollTo(0, 0);
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView();
  },
  exportBackup: () => security.exportBackup(),
};

// ---------- Sperren / Entsperren ----------

const autolockMs = () => Number(prefs().autolock || 5) * 60 * 1000;

function resetLockTimer() {
  clearTimeout(state.lockTimer);
  if (!state.key) return;
  state.lastActivity = Date.now();
  state.lockTimer = setTimeout(lock, autolockMs());
}

// Beim Wechsel in den Hintergrund Inhalte sofort verdecken; beim Zurückkehren Sperrregel prüfen.
function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (state.key) document.body.classList.add('curtain');
    return;
  }
  if (state.key && Date.now() - state.lastActivity > autolockMs()) lock();
  document.body.classList.remove('curtain');
}

function lock() {
  diary.onLock();
  documents.onLock();
  state.key = null;
  state.records = [];
  closeForm();
  ['#tab-overview', '#tab-contracts', '#tab-health', '#tab-more'].forEach(sel => $(sel).replaceChildren());
  ['#tc-endpoint', '#tc-token', '#tc-plz'].forEach(sel => { $(sel).value = ''; });
  $('#due-banner').hidden = true;
  clearTimeout(state.lockTimer);
  document.body.classList.remove('curtain');
  show('unlock');
  $('#unlock-pass').value = '';
  $('#unlock-pass').focus();
}

async function onUnlocked(key, { replaced = false } = {}) {
  state.key = key;
  state.records = await store.loadRecords(key);
  show('main');
  showTab(prefs().tab || 'overview');
  if (diary.restoreDraft()) toast('Dein letzter Entwurf wurde wiederhergestellt.');
  documents.resumeDraft(); // angefangener Scan, z. B. nach Neustart der App durch die Kamera
  resetLockTimer();
  if (replaced) broadcast('replaced');
}

async function onSetup(e) {
  e.preventDefault();
  const p1 = $('#setup-pass').value, p2 = $('#setup-pass2').value;
  const err = $('#setup-error');
  if (p1.length < 10) { err.textContent = 'Die Passphrase muss mindestens 10 Zeichen haben.'; return; }
  if (p1 !== p2) { err.textContent = 'Die Passphrasen stimmen nicht überein.'; return; }
  err.textContent = 'Tresor wird angelegt …';
  try {
    const key = await vault.createNew(p1);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    $('#form-setup').reset();
    err.textContent = '';
    await onUnlocked(key);
  } catch (ex) {
    err.textContent = ex.message || 'Tresor konnte nicht angelegt werden.';
    return;
  }
  security.offerRecovery(p1); // Nutzerweg „Erster Start“ (Master-Prompt 11): Wiederherstellungsweg gleich anbieten
}

async function onUnlock(e) {
  e.preventDefault();
  const err = $('#unlock-error');
  const btn = $('#form-unlock button[type=submit]');
  err.textContent = 'Entsperre …';
  btn.disabled = true;
  const t0 = performance.now();
  try {
    const { key, migrated } = await vault.unlock($('#unlock-pass').value);
    $('#unlock-pass').value = '';
    err.textContent = '';
    setPref('lastUnlockMs', Math.round(performance.now() - t0)); // Messwert Entsperrdauer (docs/TESTING.md)
    await onUnlocked(key);
    if (migrated) toast('Tresor auf das neue Sicherheitsformat umgestellt.');
  } catch (ex) {
    err.textContent = ex.message === 'Falsche Passphrase.' ? 'Falsche Passphrase.' : (ex.message || 'Entsperren fehlgeschlagen.');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Bereiche ----------

// Reihenfolge und Namen nach Master-Prompt 11 (docs/UX_DESIGN.md); interne IDs bleiben stabil
const TABS = { overview: 'Heute', diary: 'Tagebuch', health: 'Gesundheit', contracts: 'Verträge', more: 'Mehr' };
let currentTab = 'overview';

function showTab(tab) {
  if (!TABS[tab]) tab = 'overview';
  currentTab = tab;
  setPref('tab', tab);
  $('#main-title').textContent = TABS[tab];
  for (const t of Object.keys(TABS)) $(`#tab-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tabbar button').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === tab)));
  renderAll();
  window.scrollTo(0, 0);
}

function renderBanner() {
  const due = contracts.dueContracts(state.records, todayISO());
  const banner = $('#due-banner');
  banner.hidden = !due.length || currentTab === 'contracts' || currentTab === 'overview';
  if (!due.length) return;
  const first = due[0];
  const date = first.info.deadline || first.info.termEnd;
  banner.replaceChildren(icon('triangle-alert'), due.length === 1
    ? `Frist: ${first.c.name} bis ${formatDE(date)}`
    : `${due.length} Fristen stehen an, nächste: ${first.c.name} bis ${formatDE(date)}`);
}

function renderAll() {
  if (!state.key) return;
  if (currentTab === 'overview') overview.render($('#tab-overview'), ctx);
  if (currentTab === 'diary') diary.render();
  if (currentTab === 'contracts') contracts.render($('#tab-contracts'), ctx);
  if (currentTab === 'health') health.render($('#tab-health'), ctx);
  if (currentTab === 'more') more.render($('#tab-more'), ctx);
  renderBanner();
}

// ---------- Einstellungen ----------

async function onWipe() {
  if (!confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.')) return;
  if (prompt('Zur Bestätigung LÖSCHEN eingeben:') !== 'LÖSCHEN') return;
  await store.wipeAll();
  broadcast('replaced');
  lock();
  show('setup');
}

async function onSaveTarifcheck(e) {
  e.preventDefault();
  const endpoint = $('#tc-endpoint').value.trim();
  const token = $('#tc-token').value.trim();
  const postalCode = $('#tc-plz').value.trim();
  const status = $('#tc-status');
  if (endpoint) {
    let url;
    try { url = new URL(endpoint); } catch { url = null; }
    if (!url || url.protocol !== 'https:') { status.textContent = 'Die Adresse muss mit https:// beginnen.'; return; }
    if (!token) { status.textContent = 'Bitte auch den Zugangsschlüssel eintragen.'; return; }
  }
  if (postalCode && !/^\d{5}$/.test(postalCode)) { status.textContent = 'Die PLZ muss aus 5 Ziffern bestehen.'; return; }
  await ctx.saveConfig('tarifcheck', { endpoint, token, postalCode });
  status.textContent = endpoint ? 'Gespeichert. Der Zugangsschlüssel liegt verschlüsselt im Tresor.' : 'Gespeichert (Tarifcheck deaktiviert).';
}

async function renderSettings() {
  const p = prefs();
  $('#autolock').value = String(p.autolock || 5);
  $('#color-mode').value = p.mode || 'system';
  const current = document.documentElement.dataset.palette;
  document.querySelectorAll('#palette-picker input').forEach(r => { r.checked = r.value === current; });
  $('#app-version').textContent = `${APP_NAME} Version ${APP_VERSION}`;
  const tc = ctx.getConfig('tarifcheck');
  $('#tc-endpoint').value = tc?.endpoint || '';
  $('#tc-token').value = tc?.token || '';
  $('#tc-plz').value = tc?.postalCode || '';
  $('#tc-status').textContent = tc?.endpoint ? 'Eingerichtet. Der Zugangsschlüssel liegt verschlüsselt im Tresor.' : 'Noch nicht eingerichtet.';
  await security.renderSecuritySettings();
  const info = $('#storage-info');
  const unlockText = p.lastUnlockMs ? ` Letztes Entsperren dauerte ${(p.lastUnlockMs / 1000).toFixed(1).replace('.', ',')} s.` : '';
  info.textContent = unlockText.trim();
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    info.textContent = `Belegt: ${(usage / 1048576).toFixed(1)} MB von ca. ${(quota / 1048576).toFixed(0)} MB. `
      + (persisted ? 'Dauerhafter Speicher ist aktiv (kein Ersatz für eine Sicherung).' : 'Dauerhafter Speicher nicht bestätigt: App zum Startbildschirm hinzufügen und regelmäßig sichern.')
      + unlockText;
  }
}

const onFile = handler => e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) handler(file);
};

// ---------- Start ----------

async function init() {
  document.title = APP_NAME;
  document.querySelectorAll('.app-name').forEach(n => { n.textContent = APP_NAME; });

  security.init({ ctx, prefs, setPref, onUnlocked, refreshSettings: renderSettings });
  diary.init(ctx);
  documents.init(ctx);

  $('#form-setup').addEventListener('submit', onSetup);
  $('#form-unlock').addEventListener('submit', onUnlock);
  $('#btn-forgot').addEventListener('click', () => security.recoverAccess());
  $('#btn-lock').addEventListener('click', lock);
  $('#btn-back').addEventListener('click', () => { show('main'); renderAll(); });
  document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#due-banner').addEventListener('click', () => { // Nutzerweg „Erinnerung“: direkt zum betroffenen Vertrag
    const [first] = contracts.dueContracts(state.records, todayISO());
    showTab('contracts');
    if (first) contracts.openDetail(ctx, first.c.id);
  });
  $('#btn-export').addEventListener('click', async () => { await security.exportBackup(); renderSettings(); });
  $('#verify-import').addEventListener('change', onFile(security.verifyFile));
  $('#settings-import').addEventListener('change', onFile(security.restoreFile));
  $('#setup-import').addEventListener('change', onFile(security.restoreFile));
  $('#btn-change-pass').addEventListener('click', () => security.changePassphrase());
  $('#btn-wipe').addEventListener('click', onWipe);
  $('#form-tarifcheck').addEventListener('submit', onSaveTarifcheck);
  $('#autolock').addEventListener('change', e => { setPref('autolock', Number(e.target.value)); resetLockTimer(); });
  const applyTheme = () => window.ICH_APPLY_THEME?.(prefs().palette, prefs().mode);
  document.querySelectorAll('#palette-picker input').forEach(r => r.addEventListener('change', () => { setPref('palette', r.value); applyTheme(); }));
  $('#color-mode').addEventListener('change', e => { setPref('mode', e.target.value); applyTheme(); });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, resetLockTimer, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);

  // Mehrere Tabs: Änderungen übernehmen, bei ersetztem Tresor sperren
  channel?.addEventListener('message', async ({ data }) => {
    if (data?.type === 'replaced') { if (state.key) lock(); show((await store.getVault()) ? 'unlock' : 'setup'); return; }
    if (data?.type === 'changed' && state.key) {
      try { state.records = await store.loadRecords(state.key); renderAll(); } catch { lock(); }
    }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!window.crypto?.subtle || !window.indexedDB) {
    document.body.textContent = 'Dieser Browser unterstützt die nötige Verschlüsselung nicht. Bitte die App über HTTPS in einem aktuellen Browser öffnen.';
    return;
  }

  show((await store.getVault()) ? 'unlock' : 'setup');
}

init();
