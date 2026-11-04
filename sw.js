/* WA Scoring v0.6.4.10 PILOTO: espera aprobación para activar nueva versión. */
const VERSION = '0.6.4.10';
const CACHE = 'wa-scoring-shell-v27';
const FILES = [
  './', './index.html', './app.css?v=0.6.4.10', './app.js?v=0.6.4.10',
  './updates.js?v=0.6.4.10',
  './cloud.js?v=0.6.4.5', './eliminations.js?v=0.6.4.5',
  './qr.js?v=0.6.4.5', './firebase-config.js?v=0.6.4.5',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => {
  // NO skipWaiting en instalación: mantener la versión actual en sesiones activas.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'WA_GET_VERSION') {
    event.ports?.[0]?.postMessage({type:'WA_SW_VERSION', version:VERSION});
  }
  if (event.data?.type === 'WA_APPLY_UPDATE') {
    // Solo se envía mediante pulsación explícita de Actualizar ahora.
    event.waitUntil(self.skipWaiting());
  }
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('wa-scoring-shell-') && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const saved = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, saved)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const saved = await caches.match(event.request);
      if (saved) return saved;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    })
  );
});
