/* Truthbox service worker: cache-first so the capture flow, models and
 * crypto pipeline keep working with no connectivity after first load.
 * Evidence is produced entirely offline; only manifest delivery needs a
 * network, and that can happen later. */

const CACHE = "truthbox-v1";
const CORE = [
  "./",
  "./index.html",
  "./capture.html",
  "./verify.html",
  "./dashboard.html",
  "./css/style.css",
  "./js/crypto.js",
  "./js/capture.js",
  "./js/detect.js",
  "./js/ocr.js",
  "./js/verify.js",
  "./js/dashboard.js",
  "./icons/icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
    )
  );
});
