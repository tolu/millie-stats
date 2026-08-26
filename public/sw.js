// Deliberately minimal.
//
// Chrome wants a service worker with a fetch handler before it will offer to
// install a site; iOS only needs the manifest. This satisfies that and does
// nothing else — it caches nothing and intercepts nothing.
//
// Offline support was considered and rejected: queuing writes made without
// signal brings sync conflicts and stale caches, and this journal is filled in
// at home on wifi. A caching service worker would be the single most likely
// source of "why am I seeing yesterday's data" bugs.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass through to the network. No caching, on purpose.
});
