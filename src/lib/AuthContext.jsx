import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { clearQueryCache } from '@/lib/query-client';
import { identifyUser, resetAnalytics } from '@/lib/analytics';

const AuthContext = createContext();

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
  // Track the last authenticated email so we can detect session switches
  const lastEmailRef = useRef(null);

  const applySession = async (session) => {
    try {
      setAuthError(null);
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

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      await applySession(session);
      setIsLoadingAuth(false);
    });

    // Fires on sign-in, sign-out, token refresh, and magic-link redirect completion.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      await applySession(session);
    });

    return () => {
      active = false;
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
