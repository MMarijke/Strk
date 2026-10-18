// Minimal service worker whose only job is to be a valid target for
// registration.showNotification() -- required by src/lib/showNotification.js
// on Android Chrome, which throws "Illegal constructor" on any direct
// `new Notification(...)` call and needs a service worker to show
// notifications at all. This is not a PWA offline/caching service worker;
// no fetch handler, no cache storage.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) return client.focus();
      }
      if (url && self.clients.openWindow) return self.clients.openWindow(url);
    })()
  );
});
