const CACHE_NAME = 'mercadolimpio-v3';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

// Instala la app y guarda los archivos en el celular
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Responde rapidísimo cuando abrís la app
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );

});

