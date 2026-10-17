/*
 * FightScore service worker.
 * Caches only immutable static assets (hashed Next.js bundles, icons) and an offline notice.
 * Never caches HTML pages, API responses, auth data, judge commands or live scores: those always
 * come from the server, so nothing stale or another user's data can be served from the cache.
 * The app does NOT work offline without its server (docs/ARCHITECTURE.md §8.4).
 */
const VERSION = "v1";
const STATIC_CACHE = `fightscore-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fightscore-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // realtime socket and anything cross-origin
  if (url.pathname.startsWith("/api/")) return; // private and live data: network only, never cached

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok && res.type === "basic") cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Pages are always loaded from the network; without a server show an honest offline notice.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
