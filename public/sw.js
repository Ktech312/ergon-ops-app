// Was deliberately inert (existed only to satisfy PWA installability
// checks) until migration 095 -- E: "I have a direct message and alert
// system built into it now, I think we need that on this also." Still
// does NOT cache anything -- this app redeploys often, and a caching
// service worker risks serving a stale bundle after a deploy. Every fetch
// still just passes straight through to the network; the only new thing
// here is real Web Push handling.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// The server (/api/send-push.js) sends a JSON payload:
// { title, body, url } -- url is where tapping the notification should
// take you (e.g. straight into the conversation that sent it).
self.addEventListener("push", (event) => {
  let payload = { title: "Ergon Ops", body: "You have a new notification." };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // Not JSON (or empty) -- fall back to the default text above instead
    // of throwing and dropping the notification entirely.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
