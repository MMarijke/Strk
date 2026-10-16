import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase, FETCH_TIMEOUT_MS } from '@/api/supabaseClient';
import { clearQueryCache } from '@/lib/query-client';
import { identifyUser, resetAnalytics } from '@/lib/analytics';

const AuthContext = createContext();

// Safety net for a genuinely hung getSession() call (network stall, a
// storage/IndexedDB access issue, etc.) with nothing to catch -- without
// this, isLoadingAuth had exactly one way to ever clear, so a hang there
// left the app stuck on the loading spinner forever, requiring a manual
// reload.
//
// Sized to NOT fire before auth-js's own internal token-refresh retry loop
// has a real chance to finish -- an earlier fixed 9000ms value cut that
// loop off after roughly one retry, showing the "couldn't verify your
// session" screen while auth-js was still actively, successfully working
// toward recovery on its own. See supabaseClient.js's FETCH_TIMEOUT_MS
// comment for the full mechanism (auth-js retries for a cumulative ~30s;
// our own abort is classified as retryable, so it feeds that loop instead
// of ending it). This budget covers that ~30s window, plus one more
// FETCH_TIMEOUT_MS for whichever attempt is in flight when it ends, plus a
// second FETCH_TIMEOUT_MS for buildUser()'s own separate profile lookup
// (the timeout stays armed through that too, see below), plus a small
// margin -- a genuine last-resort ceiling, not a first response to a slow
// connection.
const SESSION_CHECK_TIMEOUT_MS = 30_000 + FETCH_TIMEOUT_MS * 2 + 2000;
// Used instead of the above when navigator.onLine already reports false
// at the moment the check starts -- the network layer has already told
// us there's nothing to wait for, so there's no reason to make the user
// sit through the full "maybe it's just slow" timeout.
const OFFLINE_SESSION_CHECK_TIMEOUT_MS = 2000;
// Persisted in sessionStorage, not just React state, because the only
// recovery action the failure screen offers is a full page reload,
// which wipes in-memory state -- without this, every reload would look
// like a first-ever failure and the app could never tell the user this
// is a repeat.
const SESSION_CHECK_ATTEMPT_KEY = 'strk-session-check-attempts';

// Shapes the Supabase auth user + profile row into the { id, email, full_name, role }
// object the rest of the app already expects (Dashboard, Social, Badges, PageNotFound, etc.)
const buildUser = async (authUser) => {
  if (!authUser) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', authUser.id)
    .single();

  return {
    id: authUser.id,
    email: authUser.email,
    full_name: authUser.user_metadata?.full_name || null,
    role: profile?.role || 'user',
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  // True only when the initial session check itself couldn't be
  // completed at all -- getSession() rejected, or the timeout below
  // fired before anything ever resolved. Distinct from authError (a
  // real, known session whose profile-row fetch failed): this means we
  // genuinely don't know whether the visitor is logged in. Drives a
  // "couldn't verify your session" screen in App.jsx instead of
  // silently treating an unverifiable state as a normal logged-out
  // visitor and dropping them into Login with no explanation.
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  // Captured once, at the moment a failure is recorded, from
  // navigator.onLine -- not read live in the UI -- so the failure
  // screen's copy describes the condition that actually caused THIS
  // failure, not whatever the network happens to be doing by render time.
  const [sessionCheckOffline, setSessionCheckOffline] = useState(false);
  // See SESSION_CHECK_ATTEMPT_KEY above for why this reads sessionStorage.
  const [sessionCheckAttempts, setSessionCheckAttempts] = useState(() => {
    try {
      return Number(sessionStorage.getItem(SESSION_CHECK_ATTEMPT_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  // Track the last authenticated email so we can detect session switches
  const lastEmailRef = useRef(null);

  const recordSessionCheckFailure = () => {
    setSessionCheckAttempts((n) => {
      const next = n + 1;
      try {
        sessionStorage.setItem(SESSION_CHECK_ATTEMPT_KEY, String(next));
      } catch {
        // Best-effort persistence only (e.g. blocked in some private
        // browsing modes) -- the in-memory count above still applies
        // for the rest of this page life.
      }
      return next;
    });
  };

  const clearSessionCheckAttempts = () => {
    setSessionCheckAttempts(0);
    try {
      sessionStorage.removeItem(SESSION_CHECK_ATTEMPT_KEY);
    } catch {
      // best-effort only, see recordSessionCheckFailure
    }
  };

  const applySession = async (session) => {
    try {
      setAuthError(null);
      setSessionCheckFailed(false);
      setSessionCheckOffline(false);
      clearSessionCheckAttempts();
      const nextUser = await buildUser(session?.user ?? null);

      // Session-switch detection: if a different user just authenticated,
      // purge every cached query so no stale data from the previous user leaks through.
      if (nextUser && lastEmailRef.current !== null && lastEmailRef.current !== nextUser.email) {
        clearQueryCache();
      }
      lastEmailRef.current = nextUser?.email ?? null;

      setUser(nextUser);
      setIsAuthenticated(!!nextUser);
      if (nextUser) identifyUser(nextUser);
    } catch (error) {
      console.error('Auth session check failed:', error);
      setAuthError({ type: 'unknown', message: error.message || 'Failed to load session' });
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    let active = true;
    // True once ANY of {getSession resolving, getSession rejecting,
    // onAuthStateChange firing} has run at least once -- guards the
    // timeout below from overwriting a result that already arrived.
    let settled = false;

    // Short-circuit the wait when the browser already knows it's
    // offline -- see OFFLINE_SESSION_CHECK_TIMEOUT_MS above.
    const startedOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const timeoutMs = startedOffline ? OFFLINE_SESSION_CHECK_TIMEOUT_MS : SESSION_CHECK_TIMEOUT_MS;

    const timeoutId = setTimeout(() => {
      if (!active || settled) return;
      console.error(`Auth session check timed out after ${timeoutMs}ms with no response.`);
      setSessionCheckOffline(startedOffline);
      recordSessionCheckFailure();
      setSessionCheckFailed(true);
      setIsLoadingAuth(false);
      // Deliberately not marked settled=true: if getSession() or
      // onAuthStateChange eventually DO resolve after this fires (a slow
      // connection rather than a true hang), applySession still runs and
      // clears sessionCheckFailed -- self-healing rather than a dead end
      // that requires a manual reload to recover from.
    }, timeoutMs);

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!active) return;
        // Deliberately NOT marking settled/clearing the timeout yet -- see
        // below. applySession() below still has its own unguarded network
        // call (the profiles lookup in buildUser), and the timeout needs to
        // stay armed against that too, not just this getSession() call.
        await applySession(session);
        if (!active) return;
        settled = true;
        clearTimeout(timeoutId);
        setIsLoadingAuth(false);
      })
      .catch((error) => {
        if (!active) return;
        settled = true;
        clearTimeout(timeoutId);
        // Treated as logged-out (not stuck) so the app always lands
        // somewhere usable, but sessionCheckFailed keeps that distinct
        // from a real "no session" visitor -- see the App.jsx screen.
        console.error('Auth session check failed:', error);
        setSessionCheckOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
        recordSessionCheckFailure();
        setSessionCheckFailed(true);
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      });

    // Fires on sign-in, sign-out, token refresh, and magic-link redirect
    // completion -- also capable of clearing isLoadingAuth on its own,
    // independent of getSession() above, since Supabase fires this once
    // with whatever session state it already has as soon as you
    // subscribe. That redundancy is the point: if getSession()'s own
    // network round-trip is what's hanging, this can still resolve auth
    // from already-cached state and clear the spinner regardless.
    //
    // The callback body is deferred via setTimeout(0) rather than run
    // directly -- auth-js's own _notifyAllSubscribers call (which invokes
    // this callback) is itself awaited from inside _recoverAndRefresh()
    // before that function resolves GoTrueClient's internal
    // initializePromise. applySession() below makes a reentrant Supabase
    // call (buildUser()'s profiles lookup), which calls getSession(),
    // which awaits that same initializePromise -- a direct promise cycle
    // that deadlocks every time _recoverAndRefresh() hasn't already
    // settled by the time this fires (e.g. right after a slow/real
    // token-refresh round-trip). Deferring to a fresh macrotask lets
    // _recoverAndRefresh() finish and resolve initializePromise first, so
    // the reentrant getSession() call inside buildUser() can proceed
    // instead of waiting on a promise that can never resolve while this
    // callback is still on the stack. This mirrors auth-js's own pattern
    // for its magic-link-redirect notification path, which defers for the
    // same reason.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setTimeout(async () => {
        if (!active) return;
        // See the matching comment in the getSession() branch above -- the
        // timeout stays armed until applySession() itself has finished.
        await applySession(session);
        if (!active) return;
        settled = true;
        clearTimeout(timeoutId);
        setIsLoadingAuth(false);
      }, 0);
    });

    return () => {
      active = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    clearQueryCache();
    resetAnalytics();
    lastEmailRef.current = null;
    setUser(null);
    setIsAuthenticated(false);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      sessionCheckFailed,
      sessionCheckOffline,
      sessionCheckAttempts,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
