let initialized = false;
// The loaded SDK module, kept here so this file is the ONLY place that
// imports @sentry/react. Anything else needing the SDK goes through an
// exported helper below, which keeps the dependency -- and its ~120KB --
// out of every chunk that merely wants to report something.
let sdk = null;

/**
 * Pre-launch config: trace every transaction (tracesSampleRate: 1.0) so
 * instrumentation can be validated end-to-end before real traffic arrives.
 * Session Replay is deliberately not enabled (no replayIntegration, no
 * replay sample rates) — too broad a data-collection surface for an app
 * handling billing data. dataCollection is set explicitly rather than left
 * to SDK defaults so that stays true even if the SDK's defaults change.
 */
// The SDK is imported dynamically rather than at the top of this file so
// that @sentry/react stays out of the entry chunk -- it was ~120KB gzipped
// of the bundle that had to arrive, parse and run before the app could
// paint anything, on every single visit.
//
// The trade-off, stated plainly: Sentry now initialises a moment after the
// first render instead of before it, so an exception thrown in that first
// render tick is no longer captured. That window is milliseconds, it only
// exists on the very first paint, and it is the price of not making every
// user wait for the SDK. Note also that this only loads at all when
// VITE_SENTRY_DSN is set, so a build without the secret ships none of it.
export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;

  // Caught here rather than at the call site: main.jsx invokes this
  // without awaiting (nothing should wait on error reporting), so an
  // uncaught rejection would surface as an unhandled promise rejection --
  // reported, ironically, by nothing.
  let Sentry;
  try {
    Sentry = await import("@sentry/react");
    sdk = Sentry;
  } catch (err) {
    console.error("Failed to load Sentry:", err);
    return;
  }

  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    // Undefined here means "propagate trace headers to every URL" (verified
    // in @sentry/core's shouldPropagateTraceForUrl -- `if (!tracePropagationTargets)
    // return true`), which was attaching sentry-trace/baggage to cross-origin
    // Supabase/Paddle requests too. That broke calls to manage-subscription/
    // send-welcome-email outright (their CORS Access-Control-Allow-Headers
    // doesn't list those headers, so the browser blocks the request) and
    // added an unnecessary extra preflight round-trip to every Supabase
    // auth/rest call on every page load. Neither buys anything today anyway
    // -- the backend has tracesSampleRate: 0 with no request-linking
    // integration, so there's nothing to link a propagated trace to.
    tracePropagationTargets: [window.location.origin],
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

/**
 * Add a Sentry breadcrumb, if Sentry is loaded and initialised.
 *
 * Exists so callers never import @sentry/react themselves.
 * showNotification.js did, for this one breadcrumb, and because
 * Dashboard.jsx reaches it through three different services that made the
 * Dashboard chunk carry the entire SDK -- defeating the point of loading
 * it lazily on exactly the screen that matters most.
 *
 * Silently does nothing when Sentry never initialised (no DSN configured,
 * or the dynamic import failed). A breadcrumb is context for an error
 * report that in that case is not being sent anywhere, so there is nothing
 * to attach it to and no reason to fetch an SDK to discard it.
 */
export function addBreadcrumb(breadcrumb) {
  if (!initialized || !sdk) return;
  sdk.addBreadcrumb(breadcrumb);
}
