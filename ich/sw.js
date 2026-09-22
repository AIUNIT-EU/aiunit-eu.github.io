// Service Worker: macht die App offline nutzbar. Cacht nur App-Dateien, niemals Nutzerdaten.
const CACHE = 'ich-v0.7.0';
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
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first für App-Dateien (Updates kommen sofort an), Cache als Offline-Fallback.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
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
