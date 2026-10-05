// TEMP-DIAGNOSTIC: on-device auth-flow visibility for the session-check
// deadlock investigation, since the report came from a phone with no
// DevTools access. Delete this entire file, and every import of it, once
// that investigation is done -- nothing else in the app should ever depend
// on it.
//
// authDiagnosticLog is a plain mutable array, not React state, on purpose:
// AuthContext.jsx pushes to it from deep inside async callbacks that run
// before anything has mounted to read it, and App.jsx only ever reads it
// once, at the moment it renders the "couldn't verify your session"
// screen -- by which point every entry relevant to that failure has
// already been pushed. No live-reactivity requirement, so no need to
// route this through context/state and risk altering render timing on
// the very code path under investigation.
export const authDiagnosticLog = [];

export function logDiag(stage, detail) {
  authDiagnosticLog.push({
    t: Math.round(performance.now()),
    stage,
    detail,
  });
}

// Gathered only when the failure screen actually renders, not eagerly --
// this is diagnostic-only data with no bearing on auth behavior itself.
export async function collectEnvironmentSnapshot() {
  const snapshot = {
    serviceWorkers: [],
    serviceWorkersError: null,
    cacheNames: [],
    cacheNamesError: null,
    locks: null,
    locksError: null,
  };

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      snapshot.serviceWorkers = regs.map((r) => ({
        scope: r.scope,
        state: r.active?.state || r.installing?.state || r.waiting?.state || 'none',
      }));
    }
  } catch (e) {
    snapshot.serviceWorkersError = e?.message || String(e);
  }

  try {
    if ('caches' in window) {
      snapshot.cacheNames = await caches.keys();
    }
  } catch (e) {
    snapshot.cacheNamesError = e?.message || String(e);
  }

  try {
    if (navigator.locks?.query) {
      const result = await navigator.locks.query();
      snapshot.locks = {
        held: (result.held || []).map((l) => l.name),
        pending: (result.pending || []).map((l) => l.name),
      };
    }
  } catch (e) {
    snapshot.locksError = e?.message || String(e);
  }

  return snapshot;
}
