const CACHE_NAME = "mercadolimpio-v20";
const BASE = "https://api-mercadolimpio.onrender.com";
const STATIC = ["./", "./index.html", "./app.js", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin === new URL(BASE).origin) { e.respondWith(fetch(e.request)); return; }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// Keep-alive cada 8 minutos
function schedulePing() {
  setTimeout(async () => {
    try { await fetch(`${BASE}/health`); } catch {}
    schedulePing();
  }, 8 * 60 * 1000);
}
schedulePing();





