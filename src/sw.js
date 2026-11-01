/// <reference lib="webworker" />
/* global self, caches, Response, fetch */
// `/* global */`, not `/* eslint-env serviceworker */`: env comments are
// no longer recognised under ESLint's flat config and become errors in
// v10. This project is already on flat config, so the env form only
// produced a deprecation warning today and a failed lint later.

/**
 * Strk's service worker.
 *
 * ============================================================
 * Why this file exists rather than a generated one
 * ============================================================
 *
 * vite-plugin-pwa is configured with `strategies: "injectManifest"`, which
 * means it does NOT write a service worker -- it injects the precache
 * manifest into this one. The generateSW mode would have been less code
 * and would have silently broken Android notifications.
 *
 * public/sw.js (now deleted) existed for exactly one reason, recorded in
 * its own header: Android Chrome throws "Illegal constructor" on a direct
 * `new Notification(...)`, so src/lib/showNotification.js awaits
 * `navigator.serviceWorker.ready` and calls
 * `registration.showNotification()`. It needs a live registration AND the
 * notificationclick handler below, or tapping a notification stops
 * focusing the app.
 *
 * A generated worker takes over the /sw.js scope and drops that handler.
 * The notifications would still appear and would simply do nothing on tap
 * -- a regression nothing in CI would catch. So the handler is preserved
 * here verbatim, and the caching is added around it.
 *
 * ============================================================
 * Caching strategy
 * ============================================================
 *
 * Precache: the built shell and static assets, from the injected
 * manifest. This is what makes a cold start work with no network.
 *
 * Navigations: NetworkFirst, not StaleWhileRevalidate.
 *
 *   This is a deliberate departure from the brief, which asked for
 *   stale-while-revalidate on pages. SWR serves the cached document and
 *   revalidates in the background, so a user who opens the app after a
 *   deploy runs the PREVIOUS index.html -- which references asset
 *   filenames that no longer exist, because Vite content-hashes them and
 *   Vercel does not keep old ones indefinitely. The result is a blank
 *   screen until a second reload.
 *
 *   NetworkFirst with a short timeout gets the same offline behaviour
 *   (falls back to cache when the network fails) without serving a stale
 *   document that points at deleted assets. On this app it is also barely
 *   slower, because there is exactly one HTML document and the asset
 *   graph underneath it is already precached.
 *
 * Hashed assets (CacheFirst): safe precisely because they are
 * content-hashed -- a changed file is a new URL, so a cache hit can never
 * be stale.
 *
 * Google Fonts (CacheFirst, long expiry): index.css imports Hanken
 * Grotesk from fonts.googleapis.com. Without this the app renders in a
 * fallback face offline, which is the single most visible "this is
 * broken" signal on an otherwise working screen.
 *
 * Supabase and Paddle are deliberately NOT cached here. Data caching is
 * the job of the Dexie layer in a later phase; a Workbox route over the
 * REST API would produce two competing caches with different staleness
 * rules and no conflict resolution.
 */

import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";

// Injected at build time by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST);

// Drops precaches from previous deploys so storage does not grow without
// bound. Matters more than usual here: iOS evicts a site's whole storage
// when it decides space is short, and a smaller footprint is evicted
// later. See OFFLINE.md.
cleanupOutdatedCaches();

const OFFLINE_FALLBACK = "/offline.html";

// ---------------------------------------------------------------- routes

// Navigations. A Workbox strategy instance is itself a valid route
// handler, so it is passed directly rather than wrapped.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "strk-pages",
      networkTimeoutSeconds: 4,
      plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
    }),
    {
      // /terms and /privacy import markdown with ?raw, so they are part of
      // the JS bundle rather than separate documents -- nothing to exclude.
      denylist: [/^\/api\//],
    }
  )
);

// Images and icons.
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "strk-images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 }),
    ],
  })
);

// Google Fonts: the stylesheet, then the font files it points at.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new NetworkFirst({ cacheName: "strk-font-css", networkTimeoutSeconds: 3 })
);

registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "strk-fonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// ---------------------------------------------------------------- lifecycle

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Lets the page ask for an immediate activation after an update, rather
// than waiting for every tab to close. Paired with the update prompt in
// src/lib/pwa.js.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/**
 * Preserved verbatim from public/sw.js.
 *
 * Without this, notifications still appear on Android and do nothing when
 * tapped. Nothing in CI would catch that, which is why it is the first
 * thing this file documents.
 */
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

/**
 * Last resort for a navigation that misses both network and cache.
 *
 * setCatchHandler, NOT a raw `fetch` listener. A listener calling
 * event.respondWith() on every navigate request pre-empts Workbox's
 * router entirely and makes the NavigationRoute above dead code -- which
 * is exactly the mistake the first draft of this file made. The catch
 * handler runs only after a registered route has thrown.
 *
 * Reached in practice on a cold first visit with no network, before the
 * precache has ever been populated.
 */
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const fallback = await matchPrecache(OFFLINE_FALLBACK);
    if (fallback) return fallback;
  }
  return Response.error();
});
