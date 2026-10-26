/**
 * One place where every route's dynamic import lives.
 *
 * The point is that App.jsx's `lazy()` calls and the prefetcher below use
 * the SAME import expression. A dynamic import is keyed by its specifier:
 * calling it twice does not fetch twice, the second call resolves from the
 * module registry. So prefetching here means React.lazy finds the chunk
 * already in memory and renders without ever suspending.
 *
 * If the prefetcher duplicated the specifiers instead of sharing them --
 * `import('../pages/Dashboard')` over there against `import('./pages/
 * Dashboard')` here -- Vite would still resolve both to one chunk, but the
 * two would be separate module records and the prefetch would warm nothing
 * React.lazy actually waits on. Sharing them is what makes this work.
 */

// The five tab destinations, in the order BottomTabBar shows them. These
// are what a signed-in user actually navigates between, so these are the
// ones worth having in memory before they tap.
export const TAB_ROUTE_IMPORTS = {
  "/Dashboard": () => import("@/pages/Dashboard"),
  "/Trends": () => import("@/pages/Trends"),
  "/Social": () => import("@/pages/Social"),
  "/Settings": () => import("@/pages/Settings"),
  "/Badges": () => import("@/pages/Badges"),
};

// Reachable while signed in, but not from the tab bar, so not part of the
// idle warm-up -- Subscription is a deliberate detour, and the two
// onboarding steps are seen once ever.
export const OTHER_APP_ROUTE_IMPORTS = {
  "/Subscription": () => import("@/pages/Subscription"),
};

export const AUTH_ROUTE_IMPORTS = {
  "/login": () => import("@/pages/Login"),
  "/signup": () => import("@/pages/Signup"),
  "/forgot-password": () => import("@/pages/ForgotPassword"),
  "/reset-password": () => import("@/pages/ResetPassword"),
  "/": () => import("@/pages/Landing"),
};

export const LEGAL_ROUTE_IMPORTS = {
  "/terms": () => import("@/pages/Terms"),
  "/privacy": () => import("@/pages/Privacy"),
};

const started = new Set();

/**
 * Fetch a route's chunk now, at most once per session.
 *
 * Rejections are swallowed on purpose. A prefetch is a guess about what
 * the user will do next, so a failed one must be invisible: if the chunk
 * genuinely cannot be fetched, React.lazy will try again at navigation
 * time and the real Suspense boundary and error handling take over there.
 * Surfacing it here would mean reporting an error for a page nobody has
 * asked for yet.
 */
export function prefetchRoute(path) {
  const load = TAB_ROUTE_IMPORTS[path] ?? OTHER_APP_ROUTE_IMPORTS[path] ?? AUTH_ROUTE_IMPORTS[path];
  if (!load || started.has(path)) return;
  started.add(path);
  load().catch(() => {
    // Allow a later, real navigation to retry rather than leaving this
    // path permanently marked as handled.
    started.delete(path);
  });
}

/**
 * Warm the tab routes once the app is idle.
 *
 * Deliberately sequential, one per idle callback, rather than firing all
 * five at once. Parallel requests would compete with whatever the page the
 * user is actually looking at still needs -- its own data queries, its
 * images -- and on a slow connection that makes the visible page slower in
 * order to make an invisible one faster. One at a time, only while the
 * browser reports itself idle, means this costs the current screen nothing.
 *
 * requestIdleCallback is absent on Safari/iOS, which is a large share of a
 * mobile PWA's users, so the fallback is a plain timeout rather than
 * skipping the warm-up on exactly the platform that benefits most.
 */
export function prefetchTabRoutesWhenIdle(currentPath) {
  const queue = Object.keys(TAB_ROUTE_IMPORTS).filter((p) => p !== currentPath);

  const schedule = typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(fn, 300);

  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchRoute(next);
    schedule(step);
  };

  schedule(step);
}
