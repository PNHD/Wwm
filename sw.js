const CACHE = 'wwm-atlas-shell-v4';
const SHELL = ['/', '/map', '/index.html', '/styles.css', '/app.js', '/bootstrap.mjs', '/manifest.webmanifest'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && (event.request.mode === 'navigate' || SHELL.includes(url.pathname))) {
        const cache = await caches.open(CACHE); await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request); if (cached) return cached;
      if (event.request.mode === 'navigate') { const shell = await caches.match('/index.html'); if (shell) return shell; }
      throw error;
    }
  })());
});
