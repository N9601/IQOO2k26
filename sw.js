/* Truthbox service worker: the capture flow, models and crypto pipeline
 * keep working with no connectivity after first load. The app's own files
 * are network-first so deploys show up at once; CDN runtimes and model
 * weights are cache-first. Evidence is produced entirely offline; only
 * manifest delivery needs a network, and that can happen later. */

const CACHE = "truthbox-v8";
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
  "./threats.html",
  "./js/intel.js",
  "./js/report.js",
  "./js/share.js",
  "./js/ondc.js",
  "./js/html.js",
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

const store = (key, res) => caches.open(CACHE).then((c) => c.put(key, res)).catch(() => {});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // Network-first for our own files. They are static, so the query string
    // (a dispatch QR's order and nonce) never changes the response: cache and
    // look up without it, so a QR link never opened before still loads offline.
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          store(key, res.clone());
          return res;
        })
        .catch(() => caches.match(key))
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
