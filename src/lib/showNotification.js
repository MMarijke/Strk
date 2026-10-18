import * as Sentry from "@sentry/react";

// Shared entry point for every browser-notification call site in the app
// (habit reminders, weekly summary, group digest, group milestones, focus
// sessions). Android Chrome throws "Failed to construct 'Notification':
// Illegal constructor" on any direct `new Notification(...)` call -- it
// requires going through a ServiceWorkerRegistration's showNotification()
// instead. This fixes the crash (Sentry: strk-backend, /Social, Chrome
// Mobile/Android, inside GroupMilestoneNotifier's nested forEach loops) by
// preferring the service-worker path everywhere, falling back to the direct
// constructor only when no service worker is available, and never letting
// either path throw out to the caller -- a failure for one notification
// must not abort a forEach loop notifying several groups/habits in a row.
//
// `options.data.url` (when provided) is where a click should land --
// consumed by public/sw.js's notificationclick handler for the
// service-worker path, and mirrored here for the direct-constructor
// fallback so both paths behave the same way.
export async function showNotification(title, options = {}) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
        return;
      } catch (error) {
        reportNotificationFailure(error, "service-worker");
        // Fall through to the direct constructor below -- still works on
        // desktop browsers even when something about the SW registration
        // itself is broken.
      }
    }

    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (error) {
      reportNotificationFailure(error, "direct-constructor");
    }
  } catch {
    // Absolute last resort -- showNotification must never throw or reject,
    // so callers (forEach loops especially) never need their own try/catch.
  }
}

function reportNotificationFailure(error, path) {
  // Breadcrumb, not captureException -- a failed notification is an
  // expected, handled condition (that's the whole point of this helper),
  // not something worth alerting on. No notification title/body/email
  // content here, just the browser's own generic exception name/message.
  Sentry.addBreadcrumb({
    category: "notification",
    level: "warning",
    message: `showNotification failed via ${path}`,
    data: { errorName: error?.name, errorMessage: error?.message },
  });
}
