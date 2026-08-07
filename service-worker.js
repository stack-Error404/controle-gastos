
const CACHE = "livro-caixa-v3-final-3.0.3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const req = event.request;
  if(req.method!=="GET") return;

  if(req.mode==="navigate"){
    event.respondWith(
      fetch(req)
        .then(response=>{
          const copy = response.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",copy));
          return response;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(response=>{
        if(response && response.status===200 && response.type==="basic"){
          const copy = response.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy));
        }
        return response;
      });
    })
  );
});
