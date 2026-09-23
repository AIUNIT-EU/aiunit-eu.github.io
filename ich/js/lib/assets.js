// Zusatzfunktionen automatisch mitladen (Teil E, Anweisung Tom: „einmal die App runterladen … alles automatisch“).
// Lädt die Erkennungsdaten aus vendor/manifest.json nacheinander von der eigenen Adresse, prüft jede Datei per SHA-256
// und legt sie im Cache des Service Workers ab. Keine Nutzerdaten, keine fremden Adressen.
// Große Daten warten auf WLAN, wo der Browser mobile Daten oder den Datensparmodus meldet (nur Android/Chromium).

const RESERVE_BYTES = 50 * 1048576; // Platz, der für den Tresor frei bleiben soll

const st = { manifest: null, groups: [], running: null, force: false, listeners: new Set() };

const emit = () => st.listeners.forEach(fn => { try { fn(snapshot()); } catch { /* Anzeige darf das Laden nicht stören */ } });

/** Beobachter für Statusänderungen; liefert eine Abmeldefunktion. */
export function onChange(fn) {
  st.listeners.add(fn);
  return () => st.listeners.delete(fn);
}

/**
 * Stand je Zusatzfunktion: { id, label, bytes, loaded, status, error }.
 * status: 'unknown' | 'loading' | 'ready' | 'waitWifi' | 'noSpace' | 'error' | 'offline'
 */
export function snapshot() {
  return st.groups.map(({ id, label, bytes, loaded, status, error }) => ({ id, label, bytes, loaded, status, error }));
}

/** Gesamtfortschritt 0–1 über alle Gruppen (für den Hinweis auf „Heute“). */
export function progress() {
  const total = st.groups.reduce((a, g) => a + g.bytes, 0);
  return total ? st.groups.reduce((a, g) => a + g.loaded, 0) / total : 0;
}

export const allReady = () => st.groups.length > 0 && st.groups.every(g => g.status === 'ready');

/** Meldet der Browser mobile Daten oder Datensparmodus? (iPhone meldet nichts, dann wird geladen.) */
export function metered() {
  const c = navigator.connection;
  return !!c && (c.saveData === true || c.type === 'cellular');
}

const vendorUrl = p => new URL(`../../vendor/${p}`, import.meta.url).href;

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

/** Wartet, bis ein Service Worker die Seite steuert (erste Installation); sonst kein dauerhafter Offline-Speicher. */
async function controlled() {
  if (!('serviceWorker' in navigator) || !('caches' in self)) return false;
  if (navigator.serviceWorker.controller) return true;
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(!!navigator.serviceWorker.controller), 15000);
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(true); }, { once: true });
  });
}

async function loadManifest() {
  const res = await fetch(vendorUrl('manifest.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Ladeliste nicht erreichbar (${res.status})`);
  const m = await res.json();
  st.manifest = m;
  st.groups = m.groups.map(g => ({ ...g, loaded: 0, status: 'unknown', error: null }));
}

/** Bereits vorhandene Dateien zählen (vorher geprüft abgelegt oder beim Benutzen geladen). */
async function countCached(g) {
  const cache = await caches.open(g.cache);
  g.missing = [];
  g.loaded = 0;
  for (const f of g.files) {
    if (await cache.match(vendorUrl(f.path), { ignoreSearch: true })) g.loaded += f.size;
    else g.missing.push(f);
  }
  return cache;
}

async function enoughSpace(bytes) {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (!quota) return true;
    return quota - usage >= bytes + RESERVE_BYTES;
  } catch {
    return true; // unbekannt: versuchen; ein Fehler beim Ablegen wird angezeigt
  }
}

/** Eine Datei laden, Prüfsumme prüfen, ablegen. Bei Abweichung einmal neu laden. */
async function fetchVerified(cache, f, onBytes) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(vendorUrl(f.path), { cache: 'no-store', headers: { 'x-ich-preload': '1' } });
    if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const buf = new Uint8Array(f.size);
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > buf.length) { at = -1; break; } // größer als erwartet: sicher falsch
      buf.set(value, at);
      at += value.length;
      onBytes(at);
    }
    if (at === f.size && (await sha256Hex(buf)) === f.sha256) {
      await cache.put(vendorUrl(f.path), new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
      return;
    }
    onBytes(0);
    await cache.delete(vendorUrl(f.path), { ignoreSearch: true }); // eine beim Benutzen abgelegte, fehlerhafte Kopie ebenfalls verwerfen
  }
  throw new Error(`${f.path}: Prüfsumme stimmt nicht`);
}

async function loadGroup(g) {
  const cache = await countCached(g);
  if (!g.missing.length) { g.status = 'ready'; emit(); return; }
  if (g.large && !st.force && metered()) { g.status = 'waitWifi'; emit(); return; }
  const need = g.missing.reduce((a, f) => a + f.size, 0);
  if (!(await enoughSpace(need))) { g.status = 'noSpace'; emit(); return; }
  g.status = 'loading';
  g.error = null;
  emit();
  for (const f of g.missing) {
    const base = g.loaded;
    let last = 0;
    await fetchVerified(cache, f, n => {
      g.loaded = base + n;
      if (n === 0 || n - last > 1048576 || n === f.size) { last = n; emit(); }
    });
    g.loaded = base + f.size;
    emit();
  }
  g.missing = [];
  g.status = 'ready';
  emit();
}

async function run() {
  if (!(await controlled())) return;
  if (!st.manifest) await loadManifest();
  for (const g of st.groups) {
    try {
      await loadGroup(g);
    } catch (err) {
      g.status = navigator.onLine === false ? 'offline' : 'error';
      g.error = String(err?.message || err);
      emit();
    }
  }
}

/**
 * Hintergrundladen starten (idempotent). Setzt nach Unterbrechung fort: vorhandene Dateien werden übersprungen.
 * force: große Daten auch über mobile Daten laden („Jetzt trotzdem laden“).
 */
export function start({ force = false } = {}) {
  if (force) st.force = true;
  if (st.running) return st.running;
  st.running = run()
    .catch(err => { console.warn('Zusatzfunktionen:', err); })
    .finally(() => { st.running = null; });
  return st.running;
}

// Nach einem Verbindungsabbruch automatisch weitermachen
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (st.groups.some(g => g.status === 'offline' || g.status === 'error')) start(); });
  navigator.connection?.addEventListener?.('change', () => { if (st.groups.some(g => g.status === 'waitWifi') && !metered()) start(); });
}
