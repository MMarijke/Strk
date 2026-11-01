/**
 * Service worker registration and update handling.
 *
 * Replaces the bare `navigator.serviceWorker.register("/sw.js")` that was
 * inline in main.jsx. That call still worked -- the built worker lands at
 * the same path -- but it gave no way to know an update was waiting, and
 * with precaching in play a stale shell matters in a way it did not when
 * the worker only handled notification clicks.
 *
 * vite-plugin-pwa is configured with `injectRegister: false`, so this is
 * the single place registration happens. Two registrations would race and
 * the losing one would be redundant.
 */

const SW_URL = "/sw.js";

/** Listeners for update availability, so the UI can offer a reload. */
const updateListeners = new Set();

export function onUpdateAvailable(fn) {
  updateListeners.add(fn);
  return () => updateListeners.delete(fn);
}

function announceUpdate(apply) {
  for (const fn of updateListeners) {
    try {
      fn(apply);
    } catch (err) {
      // A broken listener must not stop the others, or prevent the worker
      // from having registered at all.
      console.error("pwa: update listener failed", err);
    }
  }
}

/**
 * Register the worker. Best-effort and never throws.
 *
 * Deliberately silent on failure. Registration fails for reasons that are
 * not bugs and that the user can do nothing about: private browsing,
 * a disabled-storage setting, an http origin. The app works without a
 * worker -- showNotification already falls back to the direct
 * Notification constructor -- so a failure here must not surface.
 */
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Registered after load rather than during module evaluation: the
  // worker's own install step fetches and precaches the whole shell, and
  // doing that while the first paint is still competing for bandwidth
  // makes the first visit slower for no benefit. The performance work in
  // this app has been specifically about what runs before first paint.
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });

      const apply = () => {
        // Ask the waiting worker to take over, then reload once it has.
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      };

      // An update that finished installing before this listener attached.
      if (registration.waiting && navigator.serviceWorker.controller) {
        announceUpdate(apply);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `controller` being set distinguishes an UPDATE from the very
          // first install. Without that check, every first-ever visit
          // would be told an update is ready.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            announceUpdate(apply);
          }
        });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Guarded: controllerchange can fire more than once, and an
        // unguarded reload here is a reload loop.
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch {
      // See above -- intentionally swallowed.
    }
  });
}

/**
 * Whether the app is running as an installed PWA.
 *
 * Checked two ways because iOS Safari does not implement the
 * display-mode media query for standalone; it exposes
 * navigator.standalone instead.
 */
export function isInstalled() {
  if (typeof window === "undefined") return false;
  const standaloneQuery = window.matchMedia?.("(display-mode: standalone)")?.matches;

  // `any` cast, justified per CLAUDE.md: navigator.standalone is a
  // non-standard property that only iOS Safari implements, so it is
  // absent from lib.dom's Navigator and typecheck reports TS2339 on a
  // direct read. The property is the only way to detect standalone mode
  // on iOS, which does not support the display-mode media query -- so the
  // alternative is not a cleaner type, it is no iOS detection.
  const iosStandalone = /** @type {any} */ (window.navigator).standalone;

  return Boolean(standaloneQuery || iosStandalone);
}
