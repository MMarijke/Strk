-- Pro-gated daily reaction limit: free users get 3 reactions/day, Pro
-- unlimited. The limit already existed client-side (ReactionButton.jsx's
-- DAILY_LIMIT = 3), applied to every user regardless of plan, backed by a
-- client-computed count -- fully bypassable via a raw insert, same class
-- of gap as everything else found today.
--
-- No new counter table (unlike streak_freezes): every sent reaction is
-- already a full row with sender_email/created_at, so "how many today" is
-- exactly `count(*) where sender_email = X and created_at >= today` --
-- there's no extra state to track the way freezes need (used_count that
-- must persist before first use, frozen_habits tracking which habit/date).
-- A second counter table here would just be redundant, driftable state
-- for no benefit.
--
-- SECURITY DEFINER RPC rather than a WITH CHECK addition: WITH CHECK is
-- evaluated after the row is tentatively inserted, within the same
-- command -- a self-referential count(*) subquery can see the
-- currently-being-inserted row under MVCC command-counter visibility,
-- making "count < 3" an easy off-by-one to get wrong (does the 3rd
-- legitimate reaction count itself as already-included and get rejected?
-- depends on subtle visibility semantics, not something to gamble on). An
-- RPC that counts explicitly before inserting sidesteps this entirely,
-- and can return a distinguishable error (DAILY_LIMIT_REACHED, same
-- recognizable-keyword pattern as join_focus_session's
-- SESSION_IN_PROGRESS) so the client can show the specific upgrade
-- message instead of a generic failure.
--
-- plan = 'pro' matches useSubscription()'s exact client-side definition
-- (profiles[0]?.plan === "pro", no trial/subscription_status factoring
-- either side) -- confirmed via paddle-webhook/index.ts that plan only
-- flips to 'free' when Paddle's real subscription.canceled event fires,
-- which for a next_billing_period-scheduled cancellation only happens at
-- the actual end of the grace period, not the moment cancellation is
-- requested -- so this inherits the same correct behavior as
-- FreezeIndicator and everywhere else that already gates on plan, no
-- special handling needed.
--
-- reactions_insert_as_sender (20260811090003) is retired outright, not
-- left alongside this RPC -- the RPC's own insert bypasses RLS via
-- SECURITY DEFINER regardless, so leaving the old policy in place would
-- only matter for raw client inserts that skip the RPC entirely,
-- reopening exactly the bypass this migration closes. With RLS enabled
-- and zero INSERT policies, direct inserts are denied by default for
-- every role except this function's owner. Confirmed no other insert
-- path exists today: GroupDashboard.jsx's createReactionMutation (now
-- switched to call this RPC) was the only live one; src/lib/
-- reactionService.js's sendReaction() is dead code with zero importers,
-- already broken by its own recipient_name bug -- this just makes that
-- permanently inert too, not a functional regression.
drop policy if exists "reactions_insert_as_sender" on public.reactions;

create or replace function public.send_reaction(p_recipient_email text, p_emoji text, p_group_id uuid)
returns public.reactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_email text := auth.jwt() ->> 'email';
  v_is_pro boolean;
  v_sent_today integer;
  v_reaction public.reactions;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  if p_group_id is null then
    raise exception 'group_id is required';
  end if;

  -- Same group-membership check reactions_insert_as_sender used to do
  -- declaratively -- moved here since the old policy is gone.
  if not exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.member_emails @> array[p_recipient_email]
  ) then
    raise exception 'Recipient is not a member of this group';
  end if;

  select (plan = 'pro') into v_is_pro
  from public.user_profiles
  where created_by_id = auth.uid();

  if not coalesce(v_is_pro, false) then
    select count(*) into v_sent_today
    from public.reactions
    where sender_email = v_caller_email
      and created_at >= date_trunc('day', now());

    if v_sent_today >= 3 then
      raise exception 'DAILY_LIMIT_REACHED';
    end if;
  end if;

  -- sender_name derived server-side from user_profiles rather than
  -- trusted from the client -- free since this function already looks up
  -- user_profiles for the Pro check.
  insert into public.reactions (sender_email, sender_name, recipient_email, emoji, group_id, read)
  values (
    v_caller_email,
    (select display_name from public.user_profiles where created_by_id = auth.uid()),
    p_recipient_email,
    p_emoji,
    p_group_id,
    false
  )
  returning * into v_reaction;

  return v_reaction;
end;
$$;

revoke all on function public.send_reaction(text, text, uuid) from public;
grant execute on function public.send_reaction(text, text, uuid) to authenticated;
