-- Reactions from a focus session: let people react to whoever they just
-- sat through a session with.
--
-- send_reaction (20260811090005, hardened in 20260914090006 and
-- 20260914090007) is built entirely around groups: it raises when
-- p_group_id is null and authorises on both parties sharing that group.
-- That is correct for GroupDashboard, its only caller so far, but it means
-- the one place in this product where people have most obviously earned a
-- reaction -- the end of a session they just sat through together -- cannot
-- send one. Focus sessions have a nullable group_id, and participants who
-- joined by code need not share any group with the host, so a group check
-- is simply the wrong question to ask at that moment.
--
-- "We were in the same session" is as real a relationship as "we are in the
-- same group", and it is just as checkable: focus_sessions.participant_emails
-- is the same shape as groups.member_emails, and join_focus_session is the
-- only way into it.

-- ============================================================
-- Where a reaction came from.
--
-- group_id stays as-is for group reactions. A reaction now carries exactly
-- one context, and which one tells the inbox where it happened.
alter table public.reactions
  add column if not exists focus_session_id uuid references public.focus_sessions (id) on delete set null;

create index if not exists reactions_focus_session_id_idx
  on public.reactions (focus_session_id);

-- Mutual exclusion only -- deliberately NOT `num_nonnulls(...) = 1`.
--
-- Both FKs are `on delete set null`, so deleting a group (or a session)
-- nulls that column on every reaction that referenced it. A constraint
-- demanding exactly one non-null context would turn an ordinary group
-- deletion into a constraint violation and block it outright. The
-- invariant that actually survives those deletions is "never both", which
-- is what this enforces; "at least one at insert time" is enforced in the
-- function below, where it belongs.
alter table public.reactions
  drop constraint if exists reactions_single_context;
alter table public.reactions
  add constraint reactions_single_context
  check (group_id is null or focus_session_id is null);

-- ============================================================
-- send_reaction, now with two possible authorisation contexts.
--
-- The old three-argument signature is dropped rather than left alongside
-- this one. Adding a fourth defaulted parameter would create an overload,
-- and a PostgREST call naming only the original three arguments would then
-- match both candidates and fail as ambiguous -- so the existing
-- GroupDashboard call site would break in a way no test here would catch.
-- One function, one signature, the fourth argument defaulted.
--
-- Everything load-bearing in the previous version is preserved verbatim:
--   * the pg_advisory_xact_lock on the caller's email, which is the fix
--     from 20260914090006 -- without it two concurrent sends can both pass
--     the limit check;
--   * the Pro check and the DAILY_LIMIT_REACHED keyword the client
--     branches on to show its upgrade prompt;
--   * sender_name derived server-side from user_profiles, never trusted
--     from the client;
--   * and, most importantly, the BOTH-parties check from 20260914090007.
--     That migration exists because the original only validated the
--     recipient, which let a raw API call fire reactions into any group it
--     could name a real member of. The session path has to check both
--     sides too, or it reintroduces exactly that vector through a new
--     door.
drop function if exists public.send_reaction(text, text, uuid);

create or replace function public.send_reaction(
  p_recipient_email text,
  p_emoji text,
  p_group_id uuid,
  p_focus_session_id uuid default null
)
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
  v_authorised boolean := false;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  if p_recipient_email is not distinct from v_caller_email then
    raise exception 'Cannot react to yourself';
  end if;

  -- Exactly one context. Both would make the stored provenance ambiguous
  -- (and violate reactions_single_context); neither leaves nothing to
  -- authorise against.
  if (p_group_id is null) = (p_focus_session_id is null) then
    raise exception 'Exactly one of group_id or focus_session_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('send_reaction'), hashtext(v_caller_email));

  if p_group_id is not null then
    -- Unchanged from 20260914090007: both sides must belong to the group.
    select exists (
      select 1 from public.groups g
      where g.id = p_group_id
        and g.member_emails @> array[p_recipient_email]
        and g.member_emails @> array[v_caller_email]
    ) into v_authorised;

    if not v_authorised then
      raise exception 'Recipient is not a member of this group';
    end if;
  else
    -- Same check, same shape, against the session's roster. No status
    -- requirement: reacting mid-session is as legitimate as reacting at
    -- the end, and the end is simply where the UI offers it.
    select exists (
      select 1 from public.focus_sessions s
      where s.id = p_focus_session_id
        and s.participant_emails @> array[p_recipient_email]
        and s.participant_emails @> array[v_caller_email]
    ) into v_authorised;

    if not v_authorised then
      raise exception 'Recipient was not in this focus session';
    end if;
  end if;

  select (plan = 'pro') into v_is_pro
  from public.user_profiles
  where created_by_id = auth.uid();

  -- One allowance across both contexts. A separate budget for session
  -- reactions was considered and rejected: it would weaken an existing Pro
  -- incentive and add a second counting rule to keep in sync, and the
  -- client surfaces the remaining count so a free user can see the wall
  -- coming rather than hit it mid-screen.
  if not coalesce(v_is_pro, false) then
    select count(*) into v_sent_today
    from public.reactions
    where sender_email = v_caller_email
      and created_at >= date_trunc('day', now());

    if v_sent_today >= 3 then
      raise exception 'DAILY_LIMIT_REACHED';
    end if;
  end if;

  insert into public.reactions (
    sender_email, sender_name, recipient_email, emoji, group_id, focus_session_id, read
  )
  values (
    v_caller_email,
    (select display_name from public.user_profiles where created_by_id = auth.uid()),
    p_recipient_email,
    p_emoji,
    p_group_id,
    p_focus_session_id,
    false
  )
  returning * into v_reaction;

  return v_reaction;
end;
$$;

revoke all on function public.send_reaction(text, text, uuid, uuid) from public;
grant execute on function public.send_reaction(text, text, uuid, uuid) to authenticated;

-- ============================================================
-- Extend the immutability guard to the new column.
--
-- protect_reactions_fields (20260730090002) enforces "only `read` is ever
-- mutable" by comparing each field explicitly -- so a column it does not
-- name is silently writable, which would let a sender rewrite which
-- session a reaction came from after the fact. Re-declared identically
-- except for the added focus_session_id comparison.
create or replace function public.protect_reactions_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.sender_email is distinct from old.sender_email
    or new.sender_name is distinct from old.sender_name
    or new.recipient_email is distinct from old.recipient_email
    or new.group_id is distinct from old.group_id
    or new.focus_session_id is distinct from old.focus_session_id
    or new.emoji is distinct from old.emoji
    or new.created_by_id is distinct from old.created_by_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only read can be changed on reactions; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;
