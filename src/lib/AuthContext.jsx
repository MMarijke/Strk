import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { clearQueryCache } from '@/lib/query-client';
import { identifyUser, resetAnalytics } from '@/lib/analytics';

const AuthContext = createContext();

// Safety net for a genuinely hung getSession() call (network stall, a
// storage/IndexedDB access issue, etc.) with nothing to catch -- without
// this, isLoadingAuth had exactly one way to ever clear, so a hang there
// left the app stuck on the loading spinner forever, requiring a manual
// reload. 8-10s is generous for a normal session check but short enough
// that a real hang doesn't leave someone staring at a spinner.
const SESSION_CHECK_TIMEOUT_MS = 9000;

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
  // Track the last authenticated email so we can detect session switches
  const lastEmailRef = useRef(null);

  const applySession = async (session) => {
    try {
      setAuthError(null);
      setSessionCheckFailed(false);
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

    const timeoutId = setTimeout(() => {
      if (!active || settled) return;
      console.error(`Auth session check timed out after ${SESSION_CHECK_TIMEOUT_MS}ms with no response.`);
      setSessionCheckFailed(true);
      setIsLoadingAuth(false);
      // Deliberately not marked settled=true: if getSession() or
      // onAuthStateChange eventually DO resolve after this fires (a slow
      // connection rather than a true hang), applySession still runs and
      // clears sessionCheckFailed -- self-healing rather than a dead end
      // that requires a manual reload to recover from.
    }, SESSION_CHECK_TIMEOUT_MS);

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!active) return;
        settled = true;
        clearTimeout(timeoutId);
        await applySession(session);
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      settled = true;
      clearTimeout(timeoutId);
      await applySession(session);
      setIsLoadingAuth(false);
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
