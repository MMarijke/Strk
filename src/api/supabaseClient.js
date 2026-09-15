import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Browser fetch() has no default timeout -- a stalled connection (the
// common case being a backgrounded mobile PWA waking up before its network
// stack has fully reconnected) just hangs forever with no error and no
// signal. That's the actual root cause of the "must refresh every time"
// loading bug: GoTrueClient caches its init/session work as a single
// promise (`initializePromise`) for the lifetime of the client instance,
// so one stalled token-refresh fetch during startup left EVERY subsequent
// getSession() call in that page awaiting a promise that could now never
// resolve -- not just that one call. AuthContext's own 9s timeout only
// changes what the UI shows once stuck; it never freed the client to
// actually recover, which is why only a full reload (a brand new client,
// a brand new promise) ever worked.
//
// Giving every Supabase request a hard ceiling fixes this at the source:
// a stalled request now fails fast instead of hanging indefinitely, so
// _recoverAndRefresh()'s own existing error handling (which already
// tolerates a failed proactive token refresh without tearing down a still-
// valid session) gets a chance to run instead of never returning at all.
// 8s leaves a safe margin under AuthContext's 9s failure-screen timeout,
// including room for the profile lookup that still has to run afterward.
const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(input, init = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  // Combine with any signal the caller already passed rather than
  // replacing it, so this never suppresses a real cancellation (e.g.
  // react-query aborting a superseded request) -- either one firing aborts.
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutController.signal]) : timeoutController.signal;

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timeoutId));
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});
