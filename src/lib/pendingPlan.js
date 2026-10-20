// Carries a visitor's plan choice (Landing's Pricing section) across the
// signup round-trip. A query param alone doesn't survive this: clicking "Go
// Pro" lands on /signup?plan=pro, but once signUp()/signInWithPassword()
// resolves there's no guarantee the query string is still attached to
// whatever the app continues on (a full page navigation after password
// reset, for one). localStorage is what actually survives that gap.
const PENDING_PLAN_KEY = "strk-pending-plan";

export function setPendingPlan(plan) {
  try {
    localStorage.setItem(PENDING_PLAN_KEY, plan);
  } catch {
    // Best-effort only (e.g. blocked in some private browsing modes) --
    // worst case the post-auth redirect to Subscription just doesn't fire.
  }
}

export function consumePendingPlan() {
  try {
    const plan = localStorage.getItem(PENDING_PLAN_KEY);
    if (plan) localStorage.removeItem(PENDING_PLAN_KEY);
    return plan;
  } catch {
    return null;
  }
}
