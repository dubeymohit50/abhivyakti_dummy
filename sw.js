const CACHE = "abhivyakti-v16";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/default-photo.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-48.png",
  "./vendor/qrcode.min.js",
  "./vendor/barcode-detector.js",
  "./vendor/zxing_reader.wasm"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first so updates show immediately; cache is the offline fallback.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  const cacheable = url.startsWith(self.location.origin) || url.includes("fonts.g");
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }
        // Server error or site taken down (e.g. 404): keep using the saved copy
        return caches.match(e.request).then((hit) => hit || res);
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
