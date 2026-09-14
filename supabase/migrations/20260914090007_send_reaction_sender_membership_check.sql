-- Security fix: send_reaction() validated that the RECIPIENT is a member
-- of p_group_id, but never that the caller (sender) is too -- flagged as a
-- known, unaddressed gap in both 20260811090003's and 20260811090005's own
-- comments. A raw API call (not reachable through the app's own UI, since
-- ReactionButton only ever renders inside a group the sender already
-- belongs to) could send a reaction into any group, as long as the named
-- recipient is a real member of it -- a spam/harassment vector.
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

  -- Both sides of the reaction must actually belong to the named group --
  -- previously only the recipient side was checked.
  if not exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and g.member_emails @> array[p_recipient_email]
      and g.member_emails @> array[v_caller_email]
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
