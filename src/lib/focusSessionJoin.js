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
    return { ok: false, reason: classifyJoinError(error), error };
  }

  return { ok: true, session: data };
}

// Classified by matching the messages the RPC actually raises, and
// treating everything else as "we could not tell".
//
// This used to be `IN_PROGRESS` if the message said so, and `NOT_FOUND`
// for literally everything else -- which made the failure the caller
// reported a guess dressed as a diagnosis. supabaseClient.js puts a hard
// 5s AbortController ceiling on every request (see FETCH_TIMEOUT_MS), so
// a stalled connection is one of the commonest errors to arrive here, and
// it arrived classified as "session not found". A user with a perfectly
// valid code and bad wifi was told their code was wrong; they would
// re-read it, retype it, get the same answer, and conclude their friend
// had given them a bad code.
//
// Matching positively on what join_focus_session raises
// (20260807090001) is also more robust than sniffing supabase-js
// internals: the shape of a transport error differs across
// postgrest-js versions, but the RPC's own `raise exception` strings are
// ours and change only when we change them.
function classifyJoinError(error) {
  const message = error?.message || "";
  if (message.includes("SESSION_IN_PROGRESS")) return "IN_PROGRESS";
  if (message.includes("Session not found or already ended")) return "NOT_FOUND";
  if (message.includes("Not authenticated")) return "AUTH";
  return "UNREACHABLE";
}

// One copy deck for join failures, in the same module that does the
// classifying, so the three entry points cannot drift into three
// different explanations of the same reason.
const JOIN_FAILURE_COPY = {
  NOT_FOUND: "That code doesn't match an open session. Check it with whoever shared it.",
  AUTH: "You've been signed out. Sign in again to join.",
  UNREACHABLE: "Couldn't reach that session. Check your connection and try again.",
};

export function describeJoinFailure(reason) {
  return JOIN_FAILURE_COPY[reason] || JOIN_FAILURE_COPY.UNREACHABLE;
}

// Only a NOT_FOUND genuinely means the invite is spent. The banner and the
// toast both used to treat every failure as "already ended" -- and both
// dismiss the notification row when they do, so a single bad-wifi tap
// permanently threw away a still-valid invite.
export function isJoinFailurePermanent(reason) {
  return reason === "NOT_FOUND";
}
