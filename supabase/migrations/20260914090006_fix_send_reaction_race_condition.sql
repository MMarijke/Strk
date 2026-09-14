-- Security fix: send_reaction()'s daily-limit check was a plain
-- select count(*) followed by insert, with nothing serializing concurrent
-- calls from the same sender -- two requests fired close together (a
-- double-tap, or a raw API script) could both read v_sent_today = 2, both
-- pass `< 3`, and both insert, letting a free-tier user exceed the 3/day
-- cap. The migration that introduced this RPC explicitly chose an RPC
-- over a WITH CHECK precisely to avoid a related but different footgun
-- (MVCC self-visibility inside a single statement) -- this closes the
-- separate, cross-request race that approach didn't address.
--
-- Fix: an advisory lock, scoped to the caller and released automatically
-- at transaction end (pg_advisory_xact_lock, not the session-lifetime
-- variant), taken before the count check. A second concurrent call for the
-- SAME sender simply waits for the first to commit, so its own count(*)
-- then correctly sees the first call's just-inserted row. Concurrent calls
-- from different senders use different lock keys and don't contend at
-- all. No new table/counter needed, unlike apply_streak_freeze's
-- upsert-based approach -- there's no natural per-user "one row" to lock
-- here the way streak_freezes has one row per (user, month).
--
-- Two-key form (hashtext('send_reaction'), hashtext(email)) namespaces
-- this lock away from any other advisory lock this codebase might ever
-- take, rather than the single-bigint form which shares one flat keyspace
-- with everything else.
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

  perform pg_advisory_xact_lock(hashtext('send_reaction'), hashtext(v_caller_email));

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
