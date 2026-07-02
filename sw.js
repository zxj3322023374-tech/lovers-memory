const CACHE = "lovers-memory-v1";
const URLS = [
  "/lovers-memory/",
  "/lovers-memory/index.html",
  "/lovers-memory/css/style.css",
  "/lovers-memory/js/app.js",
  "/lovers-memory/manifest.json",
  "/lovers-memory/icons/icon-192.png",
  "/lovers-memory/icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
