// „Mit Google verbinden“ (CON-10, ADR-0009): Token-Modell von Google Identity Services, kein eigener Server.
// Das Zugangstoken liegt nur im Arbeitsspeicher (ca. 1 Stunde gültig) und wird beim Sperren verworfen.
// Rechte: eigener Kalender „ICH“ (calendar.app.created) und nur selbst angelegte Drive-Dateien (drive.file).

import { GOOGLE_CLIENT_ID } from '../config.js';

export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.app.created';
export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com';

let token = null;      // { value, expiresAt, calendar, drive }
let client = null;
let gisLoading = null;
let pending = null;    // { resolve, reject } der laufenden Anmeldung

export const enabled = () => !!GOOGLE_CLIENT_ID;
export const hasToken = () => !!token && Date.now() < token.expiresAt - 60_000;
export const granted = () => ({ calendar: !!token?.calendar, drive: !!token?.drive });

/** Beim Sperren und Trennen: Zugang aus dem Arbeitsspeicher entfernen. */
export function forget() {
  token = null;
  pending?.reject(Object.assign(new Error('abgebrochen'), { name: 'AbortError' }));
  pending = null;
}

export class NeedsAuth extends Error {
  constructor() { super('Die Verbindung zu Google muss kurz bestätigt werden.'); this.name = 'NeedsAuth'; }
}

/** Lädt Googles Anmelde-Bibliothek (einzige fremde Skriptquelle, nur nach dem Verbinden). */
export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; s.remove(); reject(new Error('Die Google-Anmeldung konnte nicht geladen werden. Bitte die Internetverbindung prüfen.')); };
      document.head.append(s);
    });
  }
  return gisLoading;
}

export const gisReady = () => !!window.google?.accounts?.oauth2;

function tokenClient() {
  if (!client) {
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: `${SCOPE_CALENDAR} ${SCOPE_DRIVE}`,
      callback: onToken,
      error_callback: onTokenError,
    });
  }
  return client;
}

function onToken(resp) {
  const p = pending;
  pending = null;
  if (!p) return;
  if (!resp || resp.error) { p.reject(new Error(resp?.error === 'access_denied' ? 'Google-Zugriff wurde nicht erlaubt.' : 'Die Anmeldung bei Google hat nicht geklappt.')); return; }
  const oauth = window.google.accounts.oauth2;
  const calendar = oauth.hasGrantedAllScopes(resp, SCOPE_CALENDAR);
  const drive = oauth.hasGrantedAllScopes(resp, SCOPE_DRIVE);
  if (!calendar && !drive) { p.reject(new Error('Es wurde kein Zugriff erlaubt. Bitte im Google-Fenster mindestens ein Häkchen setzen.')); return; }
  token = { value: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000, calendar, drive };
  p.resolve(granted());
}

function onTokenError(err) {
  const p = pending;
  pending = null;
  if (!p) return;
  p.reject(Object.assign(new Error(err?.type === 'popup_closed' ? 'Anmeldung abgebrochen.' : 'Das Google-Fenster konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.'), { name: err?.type === 'popup_closed' ? 'AbortError' : 'Error' }));
}

/**
 * Öffnet Googles Anmeldefenster. Muss direkt aus einem Tipp heraus aufgerufen werden (sonst blockiert der Browser das Fenster),
 * deshalb muss die Bibliothek vorher geladen sein (loadGis).
 */
export function requestToken({ consent = false } = {}) {
  if (!gisReady()) return Promise.reject(new Error('Die Google-Anmeldung ist noch nicht geladen. Bitte gleich noch einmal tippen.'));
  pending?.reject(Object.assign(new Error('abgebrochen'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient().requestAccessToken({ prompt: consent ? 'consent' : '' });
  });
}

/** Zugang bei Google widerrufen (Trennen). */
export function revoke() {
  const t = token?.value;
  token = null;
  if (t && gisReady()) window.google.accounts.oauth2.revoke(t, () => {});
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Aufruf der Google-API mit Wiederholung bei Überlastung (429/5xx) und klarer Meldung bei abgelaufenem Zugang. */
async function api(path, { method = 'GET', body, headers = {}, raw = false, allow404 = false } = {}) {
  if (!hasToken()) throw new NeedsAuth();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(path.startsWith('http') ? path : API + path, {
        method,
        headers: { Authorization: `Bearer ${token.value}`, ...(body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      });
    } catch {
      if (attempt < 2) { await wait(1000 * 2 ** attempt); continue; }
      throw new Error('Google ist gerade nicht erreichbar. Bitte später erneut versuchen.');
    }
    if (res.status === 401) { token = null; throw new NeedsAuth(); }
    if (res.status === 404 && allow404) return null;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await wait(1000 * 2 ** attempt); continue; }
    if (!res.ok) {
      if (res.status === 403) throw new Error('Google hat den Zugriff abgelehnt. Bitte die Verbindung trennen und neu verbinden.');
      throw new Error(`Google hat mit Fehler ${res.status} geantwortet. Bitte später erneut versuchen.`);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }
}

// ---------- Kalender ----------

const nextDay = iso => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Eigener Kalender „ICH“; wird neu angelegt, wenn er fehlt oder gelöscht wurde. Liefert die Kalender-ID. */
export async function ensureCalendar(calendarId) {
  if (calendarId && await api(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, { allow404: true })) return calendarId;
  const cal = await api('/calendar/v3/calendars', { method: 'POST', body: { summary: 'ICH', description: 'Erinnerungen aus der App ICH. Enthält keine Vertragsdetails.' } });
  return cal.id;
}

function eventBody(e) {
  return {
    summary: e.summary,
    description: e.description,
    start: { date: e.date },
    end: { date: nextDay(e.date) },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] }, // am Vortag 9:00 Uhr
    extendedProperties: { private: { ich: '1', ichUid: e.uid } },
  };
}

/**
 * Gleicht die Termine im Kalender „ICH“ mit den gewünschten ab (idempotent, Zuordnung über ichUid).
 * desired: [{ uid, date, summary, description }]. Liefert { created, updated, deleted }.
 */
export async function syncEvents(calendarId, desired) {
  const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const existing = new Map();
  let pageToken = '';
  do {
    const q = new URLSearchParams({ maxResults: '2500', privateExtendedProperty: 'ich=1', showDeleted: 'false' });
    if (pageToken) q.set('pageToken', pageToken);
    const page = await api(`${base}?${q}`);
    for (const ev of page.items || []) {
      const uid = ev.extendedProperties?.private?.ichUid;
      if (uid && ev.status !== 'cancelled') existing.set(uid, ev);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  const out = { created: 0, updated: 0, deleted: 0 };
  for (const d of desired) {
    const ev = existing.get(d.uid);
    existing.delete(d.uid);
    if (!ev) {
      await api(base, { method: 'POST', body: eventBody(d) });
      out.created++;
    } else if (ev.start?.date !== d.date || ev.summary !== d.summary) {
      await api(`${base}/${encodeURIComponent(ev.id)}`, { method: 'PATCH', body: eventBody(d) });
      out.updated++;
    }
  }
  for (const ev of existing.values()) {
    await api(`${base}/${encodeURIComponent(ev.id)}`, { method: 'DELETE', allow404: true });
    out.deleted++;
  }
  return out;
}

// ---------- Drive (nur selbst angelegte Dateien) ----------

/** Lädt die verschlüsselte Sicherungsdatei ins eigene Drive (fortsetzbarer Upload, auch für große Sicherungen). */
export async function uploadBackup(file) {
  const res = await api('/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    raw: true,
    headers: { 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
    body: { name: file.name, mimeType: 'application/octet-stream', appProperties: { ich: 'backup' } },
  });
  const location = res.headers.get('Location');
  if (!location) throw new Error('Google Drive hat den Upload nicht angenommen.');
  return api(location, { method: 'PUT', body: new Blob([file], { type: 'application/octet-stream' }) });
}

/** Sicherungen aus dem eigenen Drive, neueste zuerst. */
export async function listBackups() {
  const q = new URLSearchParams({
    q: "appProperties has { key='ich' and value='backup' } and trashed = false",
    orderBy: 'createdTime desc',
    pageSize: '20',
    fields: 'files(id,name,createdTime,size)',
    spaces: 'drive',
  });
  return (await api(`/drive/v3/files?${q}`)).files || [];
}

export async function downloadBackup(id) {
  const res = await api(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { raw: true });
  return res.blob();
}
