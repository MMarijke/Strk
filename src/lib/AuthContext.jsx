import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase, FETCH_TIMEOUT_MS } from '@/api/supabaseClient';
import { clearQueryCache } from '@/lib/query-client';
import { clearLocalData, getOwnerIdentity, setOwner } from '@/lib/offline/db';
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
// small margin -- a genuine last-resort ceiling, not a first response to a
// slow connection.
//
// Was `FETCH_TIMEOUT_MS * 2`, the second window covering buildUser()'s own
// profile lookup. buildUser no longer makes a network call at all (see its
// comment), so that window was budgeting for work that no longer happens
// and is removed: the ceiling drops from ~42s to ~37s.
const SESSION_CHECK_TIMEOUT_MS = 30_000 + FETCH_TIMEOUT_MS + 2000;
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

// Shapes the Supabase auth user into the { id, email, full_name } object the
// rest of the app expects (Dashboard, Social, Badges, PageNotFound, etc.)
//
// This used to `await` a `profiles.select('role')` query before returning,
// which put a second serial network round-trip in front of first paint on
// EVERY app open: getSession() had to resolve, and only then did this fire,
// and only then could isLoadingAuth clear. On a slow connection that is two
// sequential 5s FETCH_TIMEOUT_MS windows of blank spinner -- and it was the
// single largest avoidable cost in cold start.
//
// It bought nothing. Nothing in src/ ever read `user.role`, and nothing read
// the `authError` state that existed solely to report this query failing.
// Authorization here is enforced by RLS and SECURITY DEFINER functions in
// Postgres, which re-derive the caller from their JWT; a role string held in
// client memory is not a security boundary and never was one, so fetching it
// up front protected nothing.
//
// Deliberately synchronous now. A future admin surface should query
// profiles.role where it needs it, behind its own loading state, rather than
// making every user on every open wait for it.
const buildUser = (authUser) => {
  if (!authUser) return null;

  return {
    id: authUser.id,
    email: authUser.email,
    full_name: authUser.user_metadata?.full_name || null,
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
  // True when the user was resumed from the locally cached identity
  // rather than a session Supabase confirmed. Exposed so a surface that
  // needs a live session (billing, anything writing to a table the
  // offline layer does not mirror) can say so rather than failing oddly.
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  // Track the last authenticated email so we can detect session switches
  const lastEmailRef = useRef(null);
  // Set by logout() so a SIGNED_OUT event arriving while offline can
  // never be "recovered" from the cached identity it just deleted.
  const signedOutRef = useRef(false);

  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  /**
   * Open the app from the identity cached in the local store.
   *
   * This is what makes a cold start with no network possible at all. The
   * app previously had exactly two offline outcomes: getSession() could
   * not reach the network, so either the 2s offline timeout fired or it
   * resolved with no session -- the first showed "couldn't verify your
   * session", the second showed Login. Neither opens the app, however
   * much habit data is already on the device.
   *
   * Not an authorization decision. The identity was written from a
   * session Supabase itself verified, it only names who the local data
   * belongs to, and every server call still carries the real JWT and is
   * still checked by RLS -- an expired token fails there exactly as
   * before. What it buys is that the user's own cached habits are
   * readable while the network is gone.
   */
  const resumeOfflineIdentity = async () => {
    try {
      const identity = await getOwnerIdentity();
      // The email is required, not optional: every habit query in the app
      // is keyed on it (`enabled: !!user?.email`), so resuming without one
      // would open an app in which nothing renders -- more confusing than
      // the failure screen this is replacing. A store written before the
      // identity was cached has no email; that user gets the old screen
      // once, and their next online session fills it in.
      if (!identity?.id || !identity.email) return false;

      lastEmailRef.current = identity.email ?? null;
      setUser({ id: identity.id, email: identity.email, full_name: identity.full_name });
      setIsAuthenticated(true);
      setIsOfflineSession(true);
      setAuthError(null);
      setSessionCheckFailed(false);
      setSessionCheckOffline(false);
      setIsLoadingAuth(false);
      return true;
    } catch (err) {
      console.error('offline: failed to resume cached identity', err);
      return false;
    }
  };

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
      const nextUser = buildUser(session?.user ?? null);
      // A real session clears the sign-out guard: signing out and back in
      // within one page life must not leave offline resume disabled.
      if (nextUser) signedOutRef.current = false;

      // Session-switch detection: if a different user just authenticated,
      // purge every cached query so no stale data from the previous user leaks through.
      if (nextUser && lastEmailRef.current !== null && lastEmailRef.current !== nextUser.email) {
        clearQueryCache();
      }
      lastEmailRef.current = nextUser?.email ?? null;

      // Scope the local mirror to this user BEFORE anything reads it.
      // Dexie has no RLS, so this is the only thing stopping a row left
      // behind by a previous session on a shared device from being served
      // to whoever signs in next -- setOwner wipes the store when the id
      // changes. Awaited rather than fired off: a read racing ahead of it
      // is exactly the leak it prevents.
      if (nextUser?.id) {
        try {
          await setOwner(nextUser.id, nextUser);
        } catch (err) {
          // A broken local store must not block signing in. Reads fall
          // back to the network when the mirror is empty.
          console.error('offline: failed to scope local store', err);
        }
      }

      // No session, and no network to ask about one. Supabase cannot
      // verify a stored token offline, so it reports null -- which is
      // indistinguishable here from "signed out" and would drop a signed-in
      // user onto Login with their cached habits sitting right there in
      // IndexedDB. Resume from the cached identity instead. Never after an
      // explicit sign-out: that wipes the identity and sets the ref below.
      if (!nextUser && !signedOutRef.current && isOffline() && (await resumeOfflineIdentity())) {
        return;
      }

      setUser(nextUser);
      setIsAuthenticated(!!nextUser);
      setIsOfflineSession(false);
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
    const startedOffline = isOffline();
    const timeoutMs = startedOffline ? OFFLINE_SESSION_CHECK_TIMEOUT_MS : SESSION_CHECK_TIMEOUT_MS;

    // Already offline at launch: open from the cached identity now rather
    // than spending the offline timeout waiting for a verification that
    // cannot arrive. getSession() and onAuthStateChange stay running
    // below, so a real session still takes over the moment one resolves.
    if (startedOffline) {
      resumeOfflineIdentity().catch(() => {});
    }

    const timeoutId = setTimeout(() => {
      if (!active || settled) return;
      console.error(`Auth session check timed out after ${timeoutMs}ms with no response.`);
      // A cached identity is a better answer than the failure screen:
      // the session check timing out while offline is the expected case,
      // not a fault, and the data to carry on with is already local.
      resumeOfflineIdentity().then((resumed) => {
        if (!active || settled || resumed) return;
        setSessionCheckOffline(startedOffline);
        recordSessionCheckFailure();
        setSessionCheckFailed(true);
        setIsLoadingAuth(false);
      });
      // Deliberately not marked settled=true: if getSession() or
      // onAuthStateChange eventually DO resolve after this fires (a slow
      // connection rather than a true hang), applySession still runs and
      // clears sessionCheckFailed -- self-healing rather than a dead end
      // that requires a manual reload to recover from.
    }, timeoutMs);

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!active) return;
        // Deliberately NOT marking settled/clearing the timeout yet --
        // see below. This used to be because applySession() had its own
        // unguarded network call (buildUser's profiles lookup); that call
        // is gone, so applySession is now synchronous work and cannot
        // itself hang. The ordering is kept anyway: settling only after
        // applySession has run means isLoadingAuth never clears before
        // user/isAuthenticated are actually set.
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
        const offline = isOffline();
        // Offline, with habits already on the device: resume rather than
        // report a failure the user cannot act on. Online, a rejected
        // getSession() is a real fault and still surfaces as one --
        // falling back to a cached identity there would hide it.
        if (offline) {
          resumeOfflineIdentity().then((resumed) => {
            if (!active || resumed) return;
            setSessionCheckOffline(true);
            recordSessionCheckFailure();
            setSessionCheckFailed(true);
            setUser(null);
            setIsAuthenticated(false);
            setIsLoadingAuth(false);
          });
          return;
        }
        setSessionCheckOffline(false);
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
    // initializePromise. applySession() USED TO make a reentrant Supabase
    // call (buildUser()'s profiles lookup), which calls getSession(),
    // which awaits that same initializePromise -- a direct promise cycle
    // that deadlocked every time _recoverAndRefresh() hadn't already
    // settled by the time this fired (e.g. right after a slow/real
    // token-refresh round-trip).
    //
    // That reentrant call is gone: buildUser is now pure. So the specific
    // deadlock this defends against is no longer reachable from here. The
    // deferral is kept regardless, because it costs one macrotask (~0ms,
    // nothing a user can perceive) and it keeps the hazard closed against
    // the next person who adds an await to applySession -- which is
    // exactly how the deadlock arrived the first time. This mirrors
    // auth-js's own pattern
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
    // Set before the wipe, so a SIGNED_OUT event that lands while the
    // device is offline cannot resume the identity being deleted here.
    signedOutRef.current = true;
    setIsOfflineSession(false);
    clearQueryCache();
    resetAnalytics();
    lastEmailRef.current = null;

    // Explicit sign-out is the ONLY place the local mirror is wiped.
    // Never on a failed token refresh, which is indistinguishable from
    // being offline -- clearing the store because the network dropped
    // would delete unsynced check-ins, the worst thing this layer could
    // do. Note this also discards a non-empty outbox, which is correct
    // here: the user asked to leave, and replaying their writes after
    // somebody else signs in would be worse.
    try {
      await clearLocalData();
    } catch (err) {
      console.error('offline: failed to clear local store on sign-out', err);
    }

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
      isOfflineSession,
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
