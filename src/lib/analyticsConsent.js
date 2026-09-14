// Consent gate for PostHog analytics -- see this repo's CLAUDE.md
// ("Consent logging required for any marketing email capture") and
// GDPR/POPIA more broadly: initAnalytics() previously ran unconditionally
// on every page load, including the public landing page before any login,
// with no opt-in anywhere in the codebase.
const CONSENT_KEY = "strk-analytics-consent"; // "granted" | "denied"

export function getAnalyticsConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    // Private browsing / blocked storage -- treat as undecided, same as a
    // first-ever visit; the banner just asks again next time.
    return null;
  }
}

export function setAnalyticsConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Best-effort only -- see getAnalyticsConsent.
  }
}
