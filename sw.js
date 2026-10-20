// Producción y prueba comparten dominio (github.io): cada una usa su prefijo de
// caché y solo borra las suyas.
const ES_PROD = self.location.pathname.startsWith("/FacturacionML/");
const PREFIX = ES_PROD ? "mercadolimpio-" : "ml-prueba-";
const CACHE_NAME = PREFIX + "v48";
const BASE = "https://api-mercadolimpio.onrender.com";
const STATIC = [
  "./", "./index.html", "./app.js", "./manifest.json",
  "./css/app.css", "./js/config.js", "./js/ui.js", "./js/camara.js",
  "./icons-mercado-limpio/ml-icon-32.png", "./icons-mercado-limpio/ml-icon-96.png",
  "./icons-mercado-limpio/ml-icon-192.png", "./icons-mercado-limpio/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // NO interceptar la API: re-emitir un POST multipart desde el SW en iOS Safari
  // trunca el cuerpo ("Unexpected end of form").
  if (url.origin === new URL(BASE).origin) return;
  if (e.request.method !== "GET") return;

  // Red primero para el HTML (toma la versión nueva apenas se publica); caché para el resto
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// Keep-alive cada 8 minutos mientras el SW esté vivo
function schedulePing() {
  setTimeout(async () => {
    try { await fetch(`${BASE}/health`); } catch {}
    schedulePing();
  }, 8 * 60 * 1000);
}
schedulePing();
