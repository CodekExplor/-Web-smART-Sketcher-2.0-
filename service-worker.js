const CACHE = 'smart-sketcher-web-v8';
const PREFIX = 'smart-sketcher-web-';
const ASSETS = [
  './', './index.html', './css/styles.css?v=20260924-8',
  './js/app.js?v=20260924-8', './js/bluetooth.js?v=20260924-8',
  './js/config.js?v=20260924-8', './js/imageProcessor.js?v=20260924-8',
  './js/protocol.js?v=20260924-8', './js/textRenderer.js?v=20260924-8',
  './js/fontManager.js?v=20260924-8', './manifest.webmanifest?v=20260924-8',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async path => {
      const response = await fetch(new Request(path, { cache: 'no-store' }));
      if (!response.ok) throw new Error(`Nie można zapisać zasobu offline: ${path}`);
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).then(async response => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
