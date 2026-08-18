// Deliberately inert service worker -- exists only to satisfy the browser's
// PWA installability checks (some Chrome versions still require a
// registered service worker with a fetch handler for the automatic
// beforeinstallprompt event, even though manifest-only sites can often be
// installed manually via the browser menu). It does NOT cache anything --
// this app redeploys often, and a caching service worker risks serving a
// stale bundle after a deploy. Every request just passes straight through
// to the network.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
