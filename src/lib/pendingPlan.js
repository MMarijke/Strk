// Carries a visitor's plan choice (Landing's Pricing section) across the
// passwordless auth round-trip. A query param alone doesn't survive this:
// clicking "Sign in to go Pro" lands on /login?plan=pro, but completing the
// magic-link flow redirects to emailRedirectTo (the app's origin, no query
// string) — often in a different tab/window than the one that requested the
// link. localStorage is what actually survives that gap.
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
