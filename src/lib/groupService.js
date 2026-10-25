/**
 * Group RPC wrappers — thin, same shape as accountabilityService.js.
 *
 * Only the writes that cannot be done as a plain table call live here.
 * Everything else still goes through the Group/GroupChallenge entities.
 */
import { supabase } from "@/api/supabaseClient";

/**
 * Remove a member from a group AND from that group's challenges, in one
 * authorised step (see 20261025090002).
 *
 * Not a Group.update: removal has to reach group_challenges.member_emails
 * too, and the client cannot do that reliably. group_challenges_update
 * requires the challenge's own creator while the remover is the group's
 * admin — where those differ, a client write matches zero rows and
 * silently succeeds, leaving the removed member on the challenge
 * leaderboard of a group they have left.
 *
 * Returns the updated group row.
 */
export async function removeGroupMember(groupId, email) {
  const { data, error } = await supabase.rpc("remove_group_member", {
    p_group_id: groupId,
    p_email: email,
  });
  if (error) throw error;
  return data;
}
