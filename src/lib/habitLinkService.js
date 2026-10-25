/**
 * Per-member habit links — thin RPC wrappers, same shape as
 * accountabilityService.js and groupService.js.
 *
 * These replace name matching as the way a challenge or focus session
 * decides whose habit counts. A name match still happens, but only in the
 * client as a PRE-SELECTION for these calls: the stored link is always an
 * explicit choice, and nothing is ever inferred about another user's data.
 *
 * Not covered by tests, for the reason partnerNotice.test.js records about
 * accountabilityService: these are one-line passthroughs whose behaviour
 * lives in 20261026090001_per_member_habit_links.sql, and importing them
 * pulls in supabaseClient, which calls createClient at module scope and
 * throws without env vars.
 */
import { supabase } from "@/api/supabaseClient";

/**
 * Set which of the caller's own habits counts for a challenge.
 * Pass null to unlink. Server-validated: the caller must be on the
 * challenge's roster, the habit must be theirs and not archived, and the
 * challenge must not have ended.
 */
export async function linkChallengeHabit(challengeId, habitId) {
  const { error } = await supabase.rpc("link_challenge_habit", {
    p_challenge_id: challengeId,
    p_habit_id: habitId ?? null,
  });
  if (error) throw error;
}

/**
 * Set which of the caller's own habits a focus session credits.
 * Pass null to unlink.
 *
 * Separate from joining: a participant can change this during the lobby
 * without re-joining, and join_focus_session is idempotent for an existing
 * participant so it is the wrong place to carry a changeable choice.
 */
export async function linkFocusSessionHabit(sessionId, habitId) {
  const { error } = await supabase.rpc("link_focus_session_habit", {
    p_session_id: sessionId,
    p_habit_id: habitId ?? null,
  });
  if (error) throw error;
}
