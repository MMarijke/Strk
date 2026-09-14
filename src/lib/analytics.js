import posthog from "posthog-js";
import { getAnalyticsConsent } from "@/lib/analyticsConsent";

let initialized = false;

// Consent-gated: no-ops until the visitor has explicitly opted in via
// AnalyticsConsentBanner (or the Settings toggle). Called again once
// consent is granted after this first no-op call at app boot -- see
// AnalyticsConsentBanner.jsx. Also handles re-enabling after
// disableAnalyticsCapturing() within the same session (init() itself is
// only ever run once; opt_in_capturing() is what actually resumes capture
// for an already-initialized instance).
export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;
  if (getAnalyticsConsent() !== "granted") return;

  if (initialized) {
    posthog.opt_in_capturing();
    return;
  }

  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
  });
  initialized = true;
}

// Stops future event capture without tearing down the already-loaded
// PostHog instance -- posthog.opt_out_capturing() persists this choice
// itself (its own storage, independent of analyticsConsent.js) and is
// respected by every subsequent .capture()/.identify() call. Distinct
// from resetAnalytics() below, which only clears identity on logout and
// would NOT stop a still-initialized instance from continuing to capture
// anonymous events.
export function disableAnalyticsCapturing() {
  if (!initialized) return;
  posthog.opt_out_capturing();
}

export function identifyUser(user) {
  if (!initialized || !user) return;
  // id only -- no email or other PII in identify() properties. PostHog
  // already scopes to this id alone via person_profiles: "identified_only"
  // above; there's no need to also hand it a raw email address.
  posthog.identify(user.id);
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

/**
 * Event names must be snake_case, noun_verb_past (e.g. "habit_created") —
 * see ANALYTICS.md for the full taxonomy.
 */
export function trackEvent(name, properties = {}) {
  if (!initialized) return;
  posthog.capture(name, properties);
}
