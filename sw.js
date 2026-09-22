/* Truthbox service worker: cache-first so the capture flow, models and
 * crypto pipeline keep working with no connectivity after first load.
 * Evidence is produced entirely offline; only manifest delivery needs a
 * network, and that can happen later. */

const CACHE = "truthbox-v3";
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
  "./intel.html",
  "./js/intel.js",
  "./js/report.js",
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
  const sameOrigin = new URL(e.request.url).origin === location.origin;
  if (sameOrigin) {
    // Network-first for our own files so deploys show up immediately;
    // the cache still serves the whole app when offline.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for CDN runtimes and model weights: large, versioned,
    // immutable, and the reason the app works offline after first load.
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
  }
});
