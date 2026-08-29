const CACHE = "livro-caixa-v4.0.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/ocr-module.js",
  "./manifest.webmanifest",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Estratégia Network-First para garantir que novas atualizações entrem no ar na hora
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response && response.status === 200 && (response.type === "basic" || response.type === "cors")) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(req).then(cached => {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          return null;
        });
      })
  );
});
