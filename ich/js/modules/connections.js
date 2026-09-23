// Mehr → „Verbindungen“: Google Kalender und Google Drive (CON-10, ADR-0009, Variante A ohne Server).
// Gespeichert wird nur, ob verbunden ist, die Kalender-ID und Zeitpunkte (verschlüsselt, Konfiguration 'google').
// Das Zugangstoken bleibt im Arbeitsspeicher. Abgeglichen wird nach Änderungen an Verträgen, solange der Zugang gilt,
// sonst auf Knopfdruck („Jetzt abgleichen“).

import * as google from '../lib/google.js';
import { el, icon } from '../ui/dom.js';
import { openSheet, closeForm } from '../ui/form.js';
import { formatDE } from '../lib/dates.js';
import { allCalendarEvents } from './contracts.js';
import { buildBackupFile, restoreFile } from './security.js';

const st = { busy: false, timer: null, error: null };

const cfg = ctx => ctx.getConfig('google') || {};
const connected = ctx => !!cfg(ctx).connected;
const saveCfg = (ctx, patch) => ctx.saveConfig('google', { ...cfg(ctx), ...patch }, { silent: true });
const stamp = iso => (iso ? `${formatDE(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : 'noch nie');

// ---------- Anzeige ----------

/** Abschnitt unter „Mehr“. */
export function section(ctx) {
  if (!google.enabled()) return null;
  return el('section', { class: 'more-section', 'aria-labelledby': 'more-connections' },
    el('h2', { id: 'more-connections' }, icon('external-link'), 'Verbindungen'),
    el('div', { id: 'connections-box' }, ...boxNodes(ctx)));
}

function boxNodes(ctx) {
  const c = cfg(ctx);
  if (!c.connected) {
    return [
      el('p', { class: 'muted small', text: 'Optional: Fristen als Termine in einen eigenen Google-Kalender „ICH“ eintragen und die verschlüsselte Sicherung im eigenen Google Drive ablegen.' }),
      el('button', { type: 'button', class: 'secondary', id: 'btn-google-connect', onclick: () => connectFlow(ctx) }, 'Mit Google verbinden'),
    ];
  }
  const live = google.hasToken();
  return [
    el('ul', { class: 'plain-list connections-list' },
      el('li', {}, el('strong', { text: 'Google Kalender: ' }), `zuletzt abgeglichen ${stamp(c.lastSync)}`,
        c.lastResult ? ` (${c.lastResult.created} neu, ${c.lastResult.updated} geändert, ${c.lastResult.deleted} entfernt)` : '',
        c.dirty ? el('span', { class: 'warn-text', id: 'google-dirty', text: ' · Änderungen noch nicht übertragen' }) : null),
      el('li', {}, el('strong', { text: 'Google Drive: ' }), `letzte Sicherung ${stamp(c.lastBackup)}`),
      el('li', { class: 'muted small', text: live ? 'Zugang aktiv (gilt ca. eine Stunde, nur auf diesem Gerät).' : 'Zugang ruht. Beim nächsten Abgleich fragt Google kurz nach.' })),
    st.error ? el('p', { class: 'error', role: 'alert', text: st.error }) : null,
    el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'primary', id: 'btn-google-sync', disabled: st.busy, onclick: () => syncNow(ctx, { interactive: true }) }, st.busy ? 'Wird abgeglichen …' : 'Jetzt abgleichen'),
      el('button', { type: 'button', class: 'secondary', id: 'btn-google-backup', disabled: st.busy, onclick: () => backupToDrive(ctx) }, icon('upload'), 'In Google Drive sichern'),
      el('button', { type: 'button', class: 'secondary', id: 'btn-google-restore', disabled: st.busy, onclick: () => restoreFromDrive(ctx) }, icon('download'), 'Aus Google Drive wiederherstellen'),
      el('button', { type: 'button', class: 'secondary', id: 'btn-google-disconnect', onclick: () => disconnect(ctx) }, 'Trennen')),
  ];
}

export function refresh(ctx) {
  const box = document.getElementById('connections-box');
  if (box && !ctx.isLocked()) box.replaceChildren(...boxNodes(ctx));
}

// ---------- Verbinden ----------

function connectFlow(ctx) {
  const go = el('button', { type: 'button', class: 'primary', id: 'btn-google-continue', disabled: true }, 'Google wird geladen …');
  const error = el('p', { class: 'error', role: 'alert' });
  openSheet({
    title: 'Mit Google verbinden',
    subtitle: 'freiwillig, jederzeit trennbar',
    body: [
      el('ul', { class: 'plain-list' },
        el('li', { text: 'Kalender: Die App legt einen eigenen Kalender „ICH“ an. Fristen erscheinen dort als „ICH Erinnerung“, ohne Vertragsnamen, Anbieter oder Beträge. Andere Kalender sieht die App nicht.' }),
        el('li', { text: 'Drive: Die App sieht nur Dateien, die sie selbst anlegt. Die Sicherung ist verschlüsselt, Google kann sie nicht lesen.' }),
        el('li', { text: 'Der Zugang gilt etwa eine Stunde und bleibt nur auf diesem Gerät. Danach fragt Google beim nächsten Abgleich kurz nach.' }),
        el('li', { text: 'Gesundheits- und Tagebuchdaten gehen nicht an Google, nur als Teil der verschlüsselten Sicherung.' })),
      el('p', { class: 'muted small', text: 'Im Google-Fenster wählst du dein Konto und bestätigst die beiden Zugriffe. Solange die App nicht von Google geprüft ist, zeigt Google einen Warnhinweis „nicht überprüft“.' }),
      error,
    ],
    actions: [go],
    closeLabel: 'Abbrechen',
  });
  // Bibliothek vorab laden, damit der Tipp auf „Weiter“ das Google-Fenster direkt öffnen darf
  google.loadGis().then(() => { go.disabled = false; go.textContent = 'Weiter zu Google'; })
    .catch(err => { error.textContent = err.message; go.textContent = 'Nicht verfügbar'; });
  go.onclick = () => {
    error.textContent = '';
    google.requestToken({ consent: true })
      .then(async () => {
        await saveCfg(ctx, { connected: true, dirty: true });
        closeForm();
        ctx.toast('Mit Google verbunden.');
        await syncNow(ctx);
      })
      .catch(err => { if (err.name !== 'AbortError') error.textContent = err.message; });
  };
}

/** Holt einen Zugang, falls nötig. Muss aus einem Tipp heraus kommen, damit Googles Fenster aufgehen darf. */
async function ensureToken({ interactive }) {
  if (google.hasToken()) return true;
  if (!interactive) return false;
  if (!google.gisReady()) {
    await google.loadGis();
    throw new Error('Die Google-Anmeldung ist jetzt geladen. Bitte noch einmal tippen.');
  }
  await google.requestToken();
  return true;
}

// ---------- Abgleich ----------

export async function syncNow(ctx, { interactive = false } = {}) {
  if (!connected(ctx) || st.busy || ctx.isLocked()) return;
  st.error = null;
  try {
    // Die Anmeldung muss vor dem ersten await starten (Tipp-Geste)
    const ok = await ensureToken({ interactive });
    if (!ok) { await saveCfg(ctx, { dirty: true }); refresh(ctx); return; }
    if (!google.granted().calendar) { st.error = 'Für den Kalender wurde kein Zugriff erlaubt. Zum Ändern trennen und neu verbinden.'; return; }
    st.busy = true;
    refresh(ctx);
    const calendarId = await google.ensureCalendar(cfg(ctx).calendarId);
    const result = await google.syncEvents(calendarId, allCalendarEvents(ctx.records, ctx.today()));
    if (ctx.isLocked()) return;
    await saveCfg(ctx, { calendarId, lastSync: new Date().toISOString(), lastResult: result, dirty: false });
    if (interactive) ctx.toast('Google Kalender ist aktuell.');
  } catch (err) {
    if (err.name === 'AbortError') return;
    st.error = err.name === 'NeedsAuth' ? 'Die Verbindung muss kurz bestätigt werden: bitte „Jetzt abgleichen“ tippen.' : err.message;
    if (!ctx.isLocked()) await saveCfg(ctx, { dirty: true }).catch(() => {});
  } finally {
    st.busy = false;
    refresh(ctx);
  }
}

/** Nach Änderungen an Verträgen: gleich abgleichen, wenn ein Zugang besteht, sonst vormerken. */
export function contractsChanged(ctx) {
  if (!connected(ctx)) return;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    if (google.hasToken()) syncNow(ctx);
    else saveCfg(ctx, { dirty: true }).then(() => refresh(ctx)).catch(() => {});
  }, 1500);
}

// ---------- Drive ----------

async function backupToDrive(ctx) {
  st.error = null;
  try {
    await ensureToken({ interactive: true });
    if (!google.granted().drive) throw new Error('Für Google Drive wurde kein Zugriff erlaubt. Zum Ändern trennen und neu verbinden.');
    st.busy = true;
    refresh(ctx);
    const file = await buildBackupFile('Google-Drive');
    await google.uploadBackup(file);
    const now = new Date().toISOString();
    ctx.setPref('lastExport', now); // zählt als Sicherung auf einem zweiten Speicherort
    await saveCfg(ctx, { lastBackup: now });
    ctx.toast('Verschlüsselte Sicherung in Google Drive abgelegt.');
  } catch (err) {
    if (err.name !== 'AbortError') st.error = err.name === 'NeedsAuth' ? 'Bitte noch einmal tippen, Google fragt kurz nach.' : err.message;
  } finally {
    st.busy = false;
    refresh(ctx);
  }
}

async function restoreFromDrive(ctx) {
  st.error = null;
  try {
    await ensureToken({ interactive: true });
    if (!google.granted().drive) throw new Error('Für Google Drive wurde kein Zugriff erlaubt. Zum Ändern trennen und neu verbinden.');
    const files = await google.listBackups();
    openSheet({
      title: 'Sicherung aus Google Drive',
      subtitle: files.length ? 'neueste zuerst' : undefined,
      body: files.length
        ? [el('ul', { class: 'plain-list' }, files.map(f => el('li', {},
          el('button', { type: 'button', class: 'secondary drive-file', onclick: () => pickDriveFile(ctx, f) },
            `${stamp(f.createdTime)} · ${Math.max(1, Math.round(Number(f.size || 0) / 1024))} KB`))))]
        : [el('p', { class: 'muted', text: 'In deinem Google Drive liegt noch keine Sicherung aus dieser App.' })],
    });
  } catch (err) {
    if (err.name !== 'AbortError') { st.error = err.name === 'NeedsAuth' ? 'Bitte noch einmal tippen, Google fragt kurz nach.' : err.message; refresh(ctx); }
  }
}

async function pickDriveFile(ctx, f) {
  try {
    const blob = await google.downloadBackup(f.id);
    closeForm();
    await restoreFile(new File([blob], f.name || 'Google-Drive.ichbackup'));
  } catch (err) {
    st.error = err.message;
    closeForm();
    refresh(ctx);
  }
}

// ---------- Trennen und Sperren ----------

async function disconnect(ctx) {
  if (!confirm('Verbindung zu Google trennen? Der Kalender „ICH“ und die Sicherungen in deinem Drive bleiben bei Google, bis du sie dort löschst.')) return;
  google.revoke();
  st.error = null;
  await ctx.saveConfig('google', { connected: false }, { silent: true });
  refresh(ctx);
  ctx.toast('Verbindung zu Google getrennt.');
}

/** Nach dem Entsperren: Anmelde-Bibliothek vorladen, wenn verbunden (damit „Jetzt abgleichen“ das Fenster öffnen darf). */
export function onUnlocked(ctx) {
  if (connected(ctx) && google.enabled()) google.loadGis().catch(() => {});
}

export function onLock() {
  clearTimeout(st.timer);
  st.busy = false;
  st.error = null;
  google.forget();
}
