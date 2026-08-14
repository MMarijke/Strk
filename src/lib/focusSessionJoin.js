import { supabase } from "@/api/supabaseClient";

// Wraps join_focus_session (see
// supabase/migrations/20260807090001_focus_session_lobby.sql) into one
// shared call site for JoinFocusModal's manual code-entry flow and the
// one-tap join actions on FocusInviteListener's toast and
// FocusSessionInviteBanner -- a single "already in progress" / "not found"
// classification instead of three call sites each parsing the RPC's raw
// error message independently.
export async function joinFocusSession(sessionCode, confirmActive = false) {
  const { data, error } = await supabase.rpc("join_focus_session", {
    p_session_code: sessionCode.trim().toUpperCase(),
    p_confirm_active: confirmActive,
  });

  if (error) {
    if (error.message?.includes("SESSION_IN_PROGRESS")) {
      return { ok: false, reason: "IN_PROGRESS" };
    }
    return { ok: false, reason: "NOT_FOUND" };
  }

  return { ok: true, session: data };
}
