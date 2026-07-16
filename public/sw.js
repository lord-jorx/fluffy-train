// Quorum service worker — offline app shell, live network for the API.
const CACHE = 'quorum-v1';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch the debate API: it streams SSE and must hit the network live.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Cache-first for the app shell, with a network fallback that also refreshes
  // the cache; if both fail, serve the cached index so the app still opens.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => caches.match('/index.html'))
    )
  );
});
