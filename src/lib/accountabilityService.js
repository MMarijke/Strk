/**
 * Accountability Partner service — thin wrappers around the RPCs in
 * 20260915090004_accountability_partner.sql and
 * 20261024090001_accountability_shared_habit_scope.sql. Every write goes
 * through one of these; there is no direct insert/update policy on
 * accountability_partnerships or accountability_shared_habits for the
 * client to fall back to.
 *
 * Several signatures changed in 20261024090001 and the old ones were
 * DROPPED rather than overloaded — a defaulted parameter would have left
 * both resolvable, and a call naming only the original arguments would
 * then match both and fail ambiguously in PostgREST. So these argument
 * lists are not optional: omitting p_habit_ids is a 404, not a default.
 */
import { supabase } from "@/api/supabaseClient";

export async function requestPartner(partnerEmail, habitIds = []) {
  const { data, error } = await supabase.rpc("request_accountability_partner", {
    p_partner_email: partnerEmail,
    p_habit_ids: habitIds,
  });
  if (error) throw error;
  return data;
}

export async function respondToPartnerRequest(partnershipId, accept, habitIds = []) {
  const { data, error } = await supabase.rpc("respond_accountability_partner", {
    p_partnership_id: partnershipId,
    p_accept: accept,
    p_habit_ids: habitIds,
  });
  if (error) throw error;
  return data;
}

export async function endPartnership(partnershipId) {
  const { data, error } = await supabase.rpc("end_accountability_partnership", {
    p_partnership_id: partnershipId,
  });
  if (error) throw error;
  return data;
}

export async function getPartnerDashboard() {
  const { data, error } = await supabase.rpc("get_partner_dashboard");
  if (error) throw error;
  return data || [];
}

export async function sendNudge(habitId = null) {
  const { data, error } = await supabase.rpc("send_accountability_nudge", {
    p_habit_id: habitId,
  });
  if (error) throw error;
  return data;
}

/**
 * What the consent screen discloses: the requester's identity and the
 * habit names they are offering, for a still-pending invite addressed to
 * the caller. Separate from getPartnerDashboard because that one requires
 * an ACTIVE partnership, which is the thing being decided.
 *
 * Shaped like getPartnerDashboard's result: one row per offered habit,
 * or exactly one row with a null habit_name when they offered nothing.
 */
export async function getPartnerInvitePreview() {
  const { data, error } = await supabase.rpc("get_partner_invite_preview");
  if (error) throw error;
  return data || [];
}

/**
 * Replace the caller's own share scope wholesale. Full replacement rather
 * than add/remove so the client's job is "send the current selection" and
 * a lost request leaves no half-state. Returns the new count.
 *
 * Only ever touches the caller's own rows — neither side can revoke or
 * extend what the other chose to share.
 */
export async function setSharedHabits(habitIds = []) {
  const { data, error } = await supabase.rpc("set_shared_habits", {
    p_habit_ids: habitIds,
  });
  if (error) throw error;
  return data ?? 0;
}
