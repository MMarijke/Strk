import { getAnalyticsConsent } from "@/lib/analyticsConsent";

// posthog-js is loaded on demand rather than imported at the top of this
// file, because this module is statically imported by AuthContext and
// AnalyticsConsentBanner -- both of which live in the entry chunk and
// render at the app root. A static import therefore put the whole PostHog
// SDK into the bundle that has to download, parse and execute before the
// first paint of every visit, including for visitors who have refused
// analytics and will never use a byte of it.
//
// Now it is fetched only when consent is actually granted. A visitor who
// declines, or who has not answered the banner yet, never downloads it.
let posthog = null;
let initialized = false;
let loadPromise = null;

// Calls that arrive before the SDK has finished loading. Without this they
// would hit the `!initialized` guards below and be dropped -- which was
// harmless when init was synchronous (main.jsx ran it before React
// rendered, so nothing could precede it) but is not now that there is a
// real window. identifyUser in particular is called by AuthContext as soon
// as auth resolves, and losing it would leave the session unattributed for
// its entire length rather than for a moment.
let pendingIdentityId = null;
let pendingEvents = [];

function flushPending() {
  if (pendingIdentityId) {
    posthog.identify(pendingIdentityId);
    pendingIdentityId = null;
  }
  const queued = pendingEvents;
  pendingEvents = [];
  for (const [name, properties] of queued) {
    posthog.capture(name, properties);
  }
}

// Consent-gated: no-ops until the visitor has explicitly opted in via
// AnalyticsConsentBanner (or the Settings toggle). Called again once
// consent is granted after this first no-op call at app boot -- see
// AnalyticsConsentBanner.jsx. Also handles re-enabling after
// disableAnalyticsCapturing() within the same session (init() itself is
// only ever run once; opt_in_capturing() is what actually resumes capture
// for an already-initialized instance).
//
// Now returns a promise, since the SDK has to arrive first. Every caller
// invokes it without awaiting, which is intentional -- nothing in the app
// should wait on analytics -- so the rejection is handled in here.
export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return Promise.resolve();
  if (getAnalyticsConsent() !== "granted") return Promise.resolve();

  if (initialized) {
    posthog.opt_in_capturing();
    return Promise.resolve();
  }

  // Guard against a second call while the first import is still in
  // flight, which would otherwise run posthog.init twice.
  if (loadPromise) return loadPromise;

  loadPromise = import("posthog-js")
    .then((mod) => {
      posthog = mod.default;
      posthog.init(key, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
        person_profiles: "identified_only",
        capture_pageview: false,
      });
      initialized = true;
      flushPending();
    })
    .catch((err) => {
      // Analytics failing to load must never surface to the user or break
      // anything. Reset so a later consent toggle can retry.
      console.error("Failed to load analytics:", err);
      loadPromise = null;
      pendingEvents = [];
      pendingIdentityId = null;
    });

  return loadPromise;
}

// Stops future event capture without tearing down the already-loaded
// PostHog instance -- posthog.opt_out_capturing() persists this choice
// itself (its own storage, independent of analyticsConsent.js) and is
// respected by every subsequent .capture()/.identify() call. Distinct
// from resetAnalytics() below, which only clears identity on logout and
// would NOT stop a still-initialized instance from continuing to capture
// anonymous events.
export function disableAnalyticsCapturing() {
  // Also drops anything queued: if consent is being withdrawn while the
  // SDK is still loading, those calls must not be flushed afterwards.
  pendingEvents = [];
  pendingIdentityId = null;
  if (!initialized) return;
  posthog.opt_out_capturing();
}

export function identifyUser(user) {
  if (!user) return;
  // id only -- no email or other PII in identify() properties. PostHog
  // already scopes to this id alone via person_profiles: "identified_only"
  // above; there's no need to also hand it a raw email address.
  if (!initialized) {
    // Only worth holding if a load is actually underway or consent is
    // granted; otherwise this is a visitor who opted out and there is
    // nothing to attribute.
    if (loadPromise) pendingIdentityId = user.id;
    return;
  }
  posthog.identify(user.id);
}

export function resetAnalytics() {
  pendingIdentityId = null;
  if (!initialized) return;
  posthog.reset();
}

/**
 * Event names must be snake_case, noun_verb_past (e.g. "habit_created") —
 * see ANALYTICS.md for the full taxonomy.
 */
export function trackEvent(name, properties = {}) {
  if (!initialized) {
    // Same reasoning as identifyUser: queue only if the SDK is on its way.
    // Capped so a long-running session with analytics unavailable cannot
    // grow this without bound.
    if (loadPromise && pendingEvents.length < 50) {
      pendingEvents.push([name, properties]);
    }
    return;
  }
  posthog.capture(name, properties);
}
