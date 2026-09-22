// Sicherung, Wiederherstellung und Schlüsselverwaltung (Oberfläche). Logik: js/vault.js, js/store.js.
// Siehe docs/SECURITY.md und docs/features/sicherung.md.

import { APP_NAME, APP_VERSION, BACKUP_EXTENSION, BACKUP_REMIND_DAYS } from '../config.js';
import * as store from '../store.js';
import * as vault from '../vault.js';
import { openForm, openSheet, closeForm } from '../ui/form.js';
import { el, icon, downloadFile } from '../ui/dom.js';

let app = null; // { ctx, prefs, setPref, onUnlocked(key), lockUi() }

export function init(appApi) {
  app = appApi;
}

const MIN_PASS = 10;
const fmt = iso => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function checkNewPass(p1, p2) {
  if (!p1 || p1.length < MIN_PASS) throw new Error(`Die Passphrase muss mindestens ${MIN_PASS} Zeichen haben.`);
  if (p1 !== p2) throw new Error('Die Passphrasen stimmen nicht überein.');
}

// ---------- Status ----------

export function backupStatus() {
  const p = app.prefs();
  const created = p.lastExport || null;
  const verified = p.lastVerified || null;
  const due = !created || daysSince(created) >= BACKUP_REMIND_DAYS;
  return { created, verified, due };
}

export function backupStatusText() {
  const { created, verified } = backupStatus();
  if (!created) return 'Noch keine Sicherung erstellt.';
  const d = daysSince(created);
  return `Letzte Sicherung ${d === 0 ? 'heute' : `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`}`
    + (verified ? `, zuletzt geprüft am ${fmt(verified)}` : ', noch nicht geprüft');
}

// ---------- Export ----------

export async function exportBackup({ silent = false, prefix = 'Sicherung' } = {}) {
  const data = await store.exportVault(app.ctx.key(), APP_VERSION);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadFile(`${APP_NAME}-${prefix}-${stamp}${BACKUP_EXTENSION}`, JSON.stringify(data), 'application/octet-stream');
  if (prefix === 'Sicherung') app.setPref('lastExport', new Date().toISOString());
  if (!silent) app.ctx.toast('Sicherung erstellt. Bitte auf einem zweiten Medium ablegen und einmal prüfen.');
}

// ---------- Einlesen + Prüfen ----------

async function readBackupFile(file) {
  if (file.size > store.BACKUP_MAX_BYTES) throw new Error('Die Datei ist größer als die unterstützte Grenze von 200 MB.');
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist keine lesbare ICH-Sicherung (beschädigt oder abgeschnitten).');
  }
  return store.parseBackup(json);
}

function summaryNodes(summary) {
  const labels = { diary: 'Tagebuch', contract: 'Verträge', lab: 'Blutwerte', medication: 'Medikamente/Supplements', document: 'Dokumente' };
  return [
    el('div', { class: 'status-box ok-box' }, icon('circle-check'), 'Sicherung vollständig und unverändert.'),
    el('dl', { class: 'facts' },
      ...[['Erstellt', summary.exportedAt ? fmt(summary.exportedAt) : 'unbekannt'],
        ...Object.entries(summary.byModule).filter(([m]) => labels[m]).map(([m, n]) => [labels[m], String(n)]),
        ['Sprachaufnahmen', String(summary.audio)],
        ...(summary.pages ? [['Dokumentseiten', String(summary.pages)]] : [])]
        .map(([k, v]) => el('div', { class: 'fact' }, el('dt', { text: k }), el('dd', { text: v })))),
    summary.legacy ? el('p', { class: 'warn', text: 'Älteres Sicherungsformat ohne Inhaltsverzeichnis: Fehlende Einträge können hier nicht erkannt werden. Nach der Wiederherstellung bitte eine neue Sicherung erstellen.' }) : null,
  ];
}

/** Fragt Passphrase oder Wiederherstellungsschlüssel der Sicherung ab und prüft sie vollständig. */
function askAndVerify(backup, { title, submitLabel, onVerified }) {
  openForm({
    title,
    submitLabel,
    note: 'Gib die Passphrase ein, die beim Erstellen der Sicherung galt, oder alternativ deinen Wiederherstellungsschlüssel. Die Sicherung wird vollständig entschlüsselt und geprüft, bevor irgendetwas geändert wird.',
    fields: [
      { name: 'passphrase', label: 'Passphrase der Sicherung', type: 'password', autocomplete: 'current-password' },
      { name: 'recovery', label: 'oder Wiederherstellungsschlüssel', hint: 'Format XXXX-XXXX-…' },
    ],
    onSave: async data => {
      if (!data.passphrase && !data.recovery) throw new Error('Bitte Passphrase oder Wiederherstellungsschlüssel eingeben.');
      const key = await vault.keyForBackup(backup, data.recovery ? { recoveryCode: data.recovery } : { passphrase: data.passphrase });
      const summary = await store.verifyBackup(backup, key);
      app.setPref('lastVerified', new Date().toISOString());
      // Nach dem Schließen des Formulars das Ergebnis zeigen
      setTimeout(() => onVerified(key, summary), 0);
    },
  });
}

export async function verifyFile(file) {
  let backup;
  try {
    backup = await readBackupFile(file);
  } catch (e) {
    showError('Sicherung ungültig', e.message);
    return;
  }
  askAndVerify(backup, {
    title: 'Sicherung prüfen', submitLabel: 'Prüfen',
    onVerified: (key, summary) => openSheet({ title: 'Prüfung erfolgreich', body: summaryNodes(summary) }),
  });
}

/**
 * Wiederherstellung: prüfen → Zusammenfassung → (Kopie des bisherigen Tresors) → atomar ersetzen → entsperrt.
 * Ein Fehler vor dem Ersetzen lässt den bisherigen Tresor unverändert.
 */
export async function restoreFile(file) {
  let backup;
  try {
    backup = await readBackupFile(file);
  } catch (e) {
    showError('Sicherung ungültig', e.message);
    return;
  }
  askAndVerify(backup, {
    title: 'Sicherung wiederherstellen', submitLabel: 'Prüfen',
    onVerified: async (key, summary) => {
      const unlocked = !app.ctx.isLocked();
      const counts = await store.countRows();
      const hasData = !!(await store.getVault()) && (counts.records > 0 || counts.blobs > 0);
      openSheet({
        title: 'Wiederherstellen?',
        body: [
          ...summaryNodes(summary),
          hasData ? el('p', { class: 'warn', text: unlocked
            ? 'Alle Daten auf diesem Gerät werden ersetzt. Vorher wird automatisch eine Sicherung des bisherigen Tresors heruntergeladen.'
            : 'Achtung: Auf diesem Gerät liegt bereits ein gesperrter Tresor. Er wird ersetzt. Entsperre ihn vorher und sichere ihn, wenn du ihn behalten willst.' }) : null,
        ],
        actions: [el('button', { class: 'primary', id: 'btn-confirm-restore', onclick: async () => {
          try {
            if (hasData && unlocked) await exportBackup({ silent: true, prefix: 'vor-Wiederherstellung' });
            await store.replaceVault(backup);
            closeForm();
            await app.onUnlocked(key, { replaced: true });
            app.ctx.toast('Sicherung wiederhergestellt.');
          } catch (e) {
            showError('Wiederherstellung fehlgeschlagen', `${e.message} Der bisherige Tresor wurde nicht verändert.`);
          }
        } }, 'Jetzt wiederherstellen')],
        closeLabel: 'Abbrechen',
      });
    },
  });
}

function showError(title, message) {
  openSheet({ title, body: [el('p', { class: 'error', text: message })] });
}

// ---------- Passphrase und Wiederherstellungsschlüssel ----------

export function changePassphrase() {
  openForm({
    title: 'Passphrase ändern',
    submitLabel: 'Ändern',
    note: 'Deine Daten werden dabei nicht neu verschlüsselt, nur der Tresorschlüssel wird neu geschützt. Ältere Sicherungen bleiben mit der alten Passphrase lesbar.',
    fields: [
      { name: 'current', label: 'Aktuelle Passphrase', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'next', label: 'Neue Passphrase (mind. 10 Zeichen)', type: 'password', required: true, autocomplete: 'new-password' },
      { name: 'next2', label: 'Neue Passphrase wiederholen', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    onSave: async d => {
      checkNewPass(d.next, d.next2);
      await vault.changePassphrase(d.current, d.next);
      app.ctx.toast('Passphrase geändert. Erstelle jetzt am besten eine neue Sicherung.');
    },
  });
}

export function setupRecovery() {
  openForm({
    title: 'Wiederherstellungsschlüssel',
    submitLabel: 'Erstellen',
    note: 'Der Schlüssel öffnet den Tresor, falls du die Passphrase vergisst. Er wird nur EINMAL angezeigt. Bewahre ihn außerhalb des Handys auf (Papier, Safe). Wer ihn hat, kann deine Daten öffnen. Ein neuer Schlüssel ersetzt den alten.',
    fields: [{ name: 'current', label: 'Aktuelle Passphrase', type: 'password', required: true, autocomplete: 'current-password' }],
    onSave: async d => {
      const code = await vault.setupRecovery(d.current);
      setTimeout(() => showRecoveryCode(code), 0);
    },
  });
}

/** Direkt nach dem Anlegen des Tresors: Wiederherstellungsweg anbieten (Nutzerweg „Erster Start“). */
export function offerRecovery(passphrase) {
  let busy = false;
  openSheet({
    title: 'Wiederherstellung einrichten',
    subtitle: 'Empfohlen, dauert eine Minute',
    body: [
      el('p', { text: 'Vergisst du die Passphrase, kommst du ohne Wiederherstellungsschlüssel nicht mehr an deine Daten. Niemand kann sie zurücksetzen.' }),
      el('p', { class: 'muted small', text: 'Der Schlüssel wird einmal angezeigt. Schreib ihn auf Papier und bewahre ihn getrennt vom Handy auf. Du kannst ihn auch später unter Mehr → Einstellungen erstellen.' }),
    ],
    actions: [
      el('button', { class: 'secondary', id: 'btn-recovery-later', onclick: () => {
        closeForm();
        app.ctx.toast('Du kannst den Schlüssel jederzeit unter Mehr → Einstellungen erstellen.');
      } }, 'Später'),
      el('button', { class: 'primary', id: 'btn-recovery-now', onclick: async () => {
        if (busy) return;
        busy = true;
        try {
          showRecoveryCode(await vault.setupRecovery(passphrase));
        } catch (err) {
          busy = false;
          app.ctx.toast(err.message || 'Schlüssel konnte nicht erstellt werden.');
        }
      } }, icon('shield-check'), 'Jetzt erstellen'),
    ],
  });
}

function showRecoveryCode(code) {
  const confirmBox = el('input', { type: 'checkbox', name: 'noted' });
  const error = el('p', { class: 'error', role: 'alert' });
  openSheet({
    title: 'Dein Wiederherstellungsschlüssel',
    body: [
      el('p', { text: 'Schreibe diesen Schlüssel jetzt auf. Er wird nicht noch einmal angezeigt:' }),
      el('p', { class: 'recovery-code', id: 'recovery-code', text: code }),
      el('p', { class: 'muted small', text: 'Nicht als Foto in der Cloud und nicht in dieser App speichern.' }),
      el('label', { class: 'check-label' }, confirmBox, 'Ich habe den Schlüssel sicher notiert.'),
      error,
    ],
    actions: [el('button', { class: 'primary', id: 'btn-recovery-done', onclick: () => {
      if (!confirmBox.checked) { error.textContent = 'Bitte bestätigen.'; return; }
      closeForm();
      app.refreshSettings();
    } }, 'Fertig')],
  });
}

export async function removeRecovery() {
  if (!confirm('Wiederherstellungsschlüssel entfernen? Danach gibt es ohne Passphrase keinen Zugang mehr.')) return;
  await vault.removeRecovery();
  app.refreshSettings();
  app.ctx.toast('Wiederherstellungsschlüssel entfernt.');
}

/** Entsperren mit Wiederherstellungsschlüssel (Sperrbildschirm), setzt eine neue Passphrase. */
export function recoverAccess() {
  openForm({
    title: 'Mit Wiederherstellungsschlüssel öffnen',
    submitLabel: 'Öffnen',
    fields: [
      { name: 'code', label: 'Wiederherstellungsschlüssel', required: true, hint: 'Format XXXX-XXXX-…, Groß-/Kleinschreibung egal' },
      { name: 'next', label: 'Neue Passphrase (mind. 10 Zeichen)', type: 'password', required: true, autocomplete: 'new-password' },
      { name: 'next2', label: 'Neue Passphrase wiederholen', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    onSave: async d => {
      checkNewPass(d.next, d.next2);
      const key = await vault.recover(d.code, d.next);
      setTimeout(() => app.onUnlocked(key, {}), 0);
    },
  });
}

export async function renderSecuritySettings() {
  const info = await vault.recoveryInfo();
  const box = document.querySelector('#recovery-status');
  box.replaceChildren(
    el('p', { class: 'muted small', text: info
      ? `Wiederherstellungsschlüssel eingerichtet am ${fmt(info.createdAt)}.`
      : 'Kein Wiederherstellungsschlüssel eingerichtet. Ohne ihn sind die Daten bei vergessener Passphrase verloren.' }),
    el('button', { class: 'secondary', id: 'btn-recovery', onclick: setupRecovery }, icon('shield-check'), info ? 'Neuen Schlüssel erstellen' : 'Wiederherstellungsschlüssel erstellen'),
    info ? el('button', { class: 'danger', onclick: removeRecovery }, 'Schlüssel entfernen') : null);
  document.querySelector('#backup-status').textContent = backupStatusText();
}
