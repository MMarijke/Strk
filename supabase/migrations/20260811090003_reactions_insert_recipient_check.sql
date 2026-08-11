-- Security hardening found while investigating why reactions never
-- reached their recipient: reactions_insert_as_sender only ever
-- validated sender_email -- recipient_email was completely unconstrained.
-- Any authenticated user could insert a reaction with an arbitrary
-- recipient_email: a made-up address, someone in a totally different
-- group, anything -- and RLS would accept it.
--
-- Reactions are always sent in a group context in this app today (see
-- ReactionButton.jsx, only ever rendered from GroupDashboard.jsx's
-- leaderboard with group_id always set) -- so the natural, precise check
-- is the same group-membership EXISTS pattern already used by
-- group_challenges_insert_own: the recipient must actually be a member
-- of the group_id being reacted within. groups.member_emails already
-- includes the creator's own email (set at group creation, see
-- CreateGroupModal.jsx), so no separate created_by_id check is needed.
--
-- Deliberately rejects group_id is null outright rather than adding a
-- weaker "is this at least a real registered user" fallback for that
-- case: confirmed via has_table_privilege('authenticated', 'auth.users',
-- 'select') that the authenticated role has no SELECT grant on
-- auth.users at all, so a fallback check against it would either error
-- or silently never match -- worse than just rejecting outright. No
-- current code path produces a null group_id anyway; a groupless
-- reaction feature, if ever built, needs its own real validation design,
-- not a permissive placeholder added here.
--
-- Not addressed here, flagging only: this checks the RECIPIENT's group
-- membership, not the SENDER's -- nothing in this policy stops an
-- authenticated user from sending a reaction into a group they aren't a
-- member of themselves, as long as the recipient they name is a real
-- member of it. In practice the app UI only ever renders ReactionButton
-- inside a group the sender already belongs to (groups_select RLS blocks
-- a non-member from even fetching the group to reach that UI), so this
-- is a raw-API-only gap, not reachable through the app -- but it's a
-- real, separate hole from the one this migration closes.
drop policy if exists "reactions_insert_as_sender" on public.reactions;
create policy "reactions_insert_as_sender" on public.reactions for insert
  with check (
    sender_email = current_email()
    and group_id is not null
    and exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.member_emails @> array[recipient_email]
    )
  );
