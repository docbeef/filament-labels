// Offline: cache-first app shell. Bump VERSION on every deploy (and after rebuilding data.json).
const VERSION = "fl-2026-11-14c";
const FILES = ["./", "index.html", "app.js", "render.js", "qrcode.js", "data.json", "brand-urls.json",
  "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "fonts/BarlowSemiCondensed-Bold.ttf", "fonts/BarlowSemiCondensed-Medium.ttf", "fonts/BarlowCondensed-SemiBold.ttf"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
