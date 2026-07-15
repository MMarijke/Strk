import posthog from "posthog-js";

let initialized = false;

export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || initialized) return;

  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
  });
  initialized = true;
}

export function identifyUser(user) {
  if (!initialized || !user) return;
  posthog.identify(user.id, { email: user.email });
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
