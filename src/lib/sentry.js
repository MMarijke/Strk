import * as Sentry from "@sentry/react";

let initialized = false;

/**
 * Pre-launch config: trace every transaction (tracesSampleRate: 1.0) so
 * instrumentation can be validated end-to-end before real traffic arrives.
 * Session Replay is deliberately not enabled (no replayIntegration, no
 * replay sample rates) — too broad a data-collection surface for an app
 * handling billing data. dataCollection is set explicitly rather than left
 * to SDK defaults so that stays true even if the SDK's defaults change.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    dataCollection: {
      userInfo: false,
      httpBodies: [],
      // Not explicitly requested up front, but headers default to collected
      // (`{ request: true, response: true }`) and this app's own fetch/XHR
      // calls carry a Supabase apikey/Authorization header — closing this
      // off rather than relying on the SDK never attaching them in practice.
      httpHeaders: { request: false, response: false },
    },
    // Backstop alongside dataCollection.userInfo above. Verified directly in
    // @sentry/browser's BrowserClient constructor that userInfo: false sets
    // `infer_ip: "never"` in the SDK metadata sent to Sentry, telling its
    // server not to infer IP/Geography from the connecting request. That
    // same dataCollection.userInfo flag turned out NOT to hold for a
    // different integration on the backend (see
    // supabase/functions/_shared/sentry.ts) — so don't rely on the gate
    // alone here either; strip event.user outright. Nothing in this
    // codebase calls Sentry.setUser().
    beforeSend(event) {
      delete event.user;
      return event;
    },
    // TODO: lower before real traffic — 100% sampling is a pre-launch-only setting.
    tracesSampleRate: 1.0,
  });
  initialized = true;
}
