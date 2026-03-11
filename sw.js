// ============================================
// SERVICE WORKER - Mercado Limpio v2
// Keep-alive en background, cache inteligente
// ============================================

const CACHE_NAME = "mercadolimpio-v14";
const BASE = "https://api-mercadolimpio.onrender.com";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json"
];

// ── Instalación ──────────────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activación (limpia caches viejos) ────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first para assets propios, network-first para API ──
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Requests a nuestra API → siempre red
  if (url.origin === new URL(BASE).origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Assets estáticos → cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Keep-alive periódico desde el SW ─────────────────────────
// Esto corre incluso si la app está en background (en Android)
// En iOS el SW se suspende, pero en Android mantiene el servidor despierto
self.addEventListener("message", event => {
  if (event.data === "KEEPALIVE") {
    fetch(`${BASE}/health`).catch(() => {});
  }
});

// Autoping cada 8 minutos dentro del SW
const pingInterval = 8 * 60 * 1000;
function schedulePing() {
  setTimeout(async () => {
    try { await fetch(`${BASE}/health`); } catch {}
    schedulePing();
  }, pingInterval);
}
schedulePing();
