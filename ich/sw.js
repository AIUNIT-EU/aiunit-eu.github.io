// Service Worker: macht die App offline nutzbar. Cacht nur App-Dateien, niemals Nutzerdaten.
const CACHE = 'ich-v0.9.0';
// Eigene Caches für die Zusatzfunktionen (vendor/manifest.json). Die Namen enthalten eine Prüfsumme der Dateien:
// Sie bleiben über App-Updates erhalten und ändern sich nur, wenn sich die Erkennungsdaten ändern.
const VENDOR_CACHES = {
  'tesseract/': 'ich-vendor-ocr-035e91a9a8',
  'transformers/': 'ich-vendor-speech-393e4e6750',
  'whisper/': 'ich-vendor-speech-393e4e6750',
};
const KEEP = new Set([CACHE, ...Object.values(VENDOR_CACHES)]);
const vendorCache = pathname => {
  const i = pathname.indexOf('/vendor/');
  if (i < 0) return null;
  const rest = pathname.slice(i + 8);
  const prefix = Object.keys(VENDOR_CACHES).find(p => rest.startsWith(p));
  return prefix ? VENDOR_CACHES[prefix] : null;
};
const ASSETS = [
  './',
  './index.html',
  './css/themes.css',
  './css/app.css',
  './js/theme-init.js',
  './js/app.js',
  './js/config.js',
  './js/crypto.js',
  './js/vault.js',
  './js/store.js',
  './js/lib/dates.js',
  './js/lib/contract-logic.js',
  './js/lib/ics.js',
  './js/lib/compare-links.js',
  './js/lib/tarifcheck.js',
  './js/lib/image.js',
  './js/lib/ocr.js',
  './js/lib/parse-lab.js',
  './js/lib/parse-contract.js',
  './js/lib/lab-catalog.js',
  './js/lib/lab-insights.js',
  './js/lib/impulses.js',
  './js/lib/transcribe.js',
  './js/lib/transcribe-worker.js',
  './js/lib/assets.js',
  './js/lib/google.js',
  './js/ui/dom.js',
  './js/ui/form.js',
  './js/ui/chart.js',
  './js/modules/contracts.js',
  './js/modules/health.js',
  './js/modules/overview.js',
  './js/modules/diary.js',
  './js/modules/security.js',
  './js/modules/documents.js',
  './js/modules/more.js',
  './js/modules/extras.js',
  './js/modules/connections.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Eine neue Version wartet, bis der Nutzer in der App „Aktualisieren“ tippt (REL-02, docs/ARCHITECTURE.md).
// Nur bei der allerersten Installation gibt es keine alte Version, dann wird sie sofort aktiv.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first für App-Dateien (Updates kommen sofort an), Cache als Offline-Fallback.
// Ausnahme: Erkennungsdaten unter vendor/ (groß, versioniert) – Cache-first, einmal geladen, danach offline.
// Das Hintergrundladen (js/lib/assets.js) prüft die Prüfsumme und legt selbst ab; dafür nur durchreichen.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const cacheName = vendorCache(url.pathname);
  if (cacheName) {
    event.respondWith(caches.open(cacheName).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !req.headers.get('x-ich-preload')) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
