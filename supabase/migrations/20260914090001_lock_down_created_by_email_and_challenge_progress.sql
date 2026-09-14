-- Security fix: created_by_email_column.sql (20260702120005) added a
-- denormalized `created_by` (email) column to 9 tables, auto-populated
-- from the JWT via a column DEFAULT -- but a DEFAULT only applies when the
-- client omits the column. Every insert/update policy in
-- 20260702120003_rls_policies.sql only checks `created_by_id = auth.uid()`
-- (uuid, RLS-authoritative); none of them constrain `created_by` (text) at
-- all. So any authenticated user could set their OWN row's `created_by` to
-- an arbitrary victim's email on insert, and (except on reactions/
-- challenge_notifications, which already reject any created_by change on
-- update via 20260730090002's triggers) change it again later via update.
--
-- This was directly exploitable: get_challenge_member_progress
-- (20260813090001) joins habits to challenge members BY EMAIL
-- (`h.created_by = m.member_email`), not by created_by_id. A user could
-- insert/update their own habit with created_by set to a victim's email
-- and a name matching the challenge's habit_name, with fabricated
-- completions -- and the RPC (SECURITY DEFINER, bypasses RLS) would report
-- that fabricated data to the whole group as the victim's real progress.
--
-- Fix, in two parts:
--   1. `created_by` becomes fully server-controlled on every one of the 9
--      tables: stamped to current_email() on insert (ignoring whatever the
--      client sends) and pinned to its existing value on update (ignoring
--      any attempted change) wherever that isn't already enforced. This
--      makes `created_by` a trustworthy mirror of created_by_id everywhere
--      it's used as a join/filter key across the app (groups,
--      group_challenges, digests, etc.), not just habits.
--   2. get_challenge_member_progress is rewritten to join through
--      user_profiles.created_by_id (uuid, never client-writable) instead
--      of trusting habits.created_by directly -- defense in depth on top
--      of (1), not a substitute for it.
--
-- reactions and challenge_notifications already block created_by from
-- changing on UPDATE (20260730090002's protect_*_fields triggers, which
-- reject the whole update if created_by/created_by_id differ) -- that's
-- stricter than the "pin to old value" trigger added here, so they're only
-- given the INSERT-time stamp below, not a second, redundant UPDATE
-- trigger. user_badges has no UPDATE policy at all (dropped in
-- 20260730090002, no legitimate update path exists), so it only needs the
-- INSERT-time stamp too.

-- ============================================================
-- Stamp created_by = current_email() on insert, unconditionally. Matches
-- the column's own DEFAULT (current_email()), so this is a no-op for every
-- legitimate insert that omits or correctly sets created_by -- it only
-- changes behavior for an insert that tries to set created_by to something
-- else. SECURITY DEFINER for consistency with the other created_by/column-
-- lockdown triggers in this codebase; only current_email() (JWT-based) is
-- read here, never current_user, so the SECURITY DEFINER/INVOKER trap from
-- the freeze_rpc_trusted work does not apply.
-- ============================================================
create or replace function public.stamp_created_by_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := public.current_email();
  return new;
end;
$$;

create trigger stamp_created_by_email_trigger
  before insert on public.habits
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.user_profiles
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.groups
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.group_challenges
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.focus_sessions
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.reactions
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.challenge_notifications
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.streak_freezes
  for each row execute function public.stamp_created_by_email();

create trigger stamp_created_by_email_trigger
  before insert on public.user_badges
  for each row execute function public.stamp_created_by_email();

-- ============================================================
-- Pin created_by to its existing value on update -- immutable after
-- creation, on every table where nothing already enforces that (reactions
-- and challenge_notifications are handled by their own, stricter
-- protect_*_fields triggers; user_badges has no UPDATE policy at all).
-- Pinning to OLD rather than raising an exception is deliberately
-- permissive: any legitimate update that doesn't touch created_by (the
-- overwhelming majority) behaves identically either way, but this way a
-- client that redundantly echoes the unchanged value back doesn't need
-- special-casing.
-- ============================================================
create or replace function public.preserve_created_by_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger preserve_created_by_email_trigger
  before update on public.habits
  for each row execute function public.preserve_created_by_email();

create trigger preserve_created_by_email_trigger
  before update on public.user_profiles
  for each row execute function public.preserve_created_by_email();

create trigger preserve_created_by_email_trigger
  before update on public.groups
  for each row execute function public.preserve_created_by_email();

create trigger preserve_created_by_email_trigger
  before update on public.group_challenges
  for each row execute function public.preserve_created_by_email();

create trigger preserve_created_by_email_trigger
  before update on public.focus_sessions
  for each row execute function public.preserve_created_by_email();

create trigger preserve_created_by_email_trigger
  before update on public.streak_freezes
  for each row execute function public.preserve_created_by_email();

-- ============================================================
-- get_challenge_member_progress: join through user_profiles.created_by_id
-- (uuid, RLS-authoritative, never client-writable) instead of trusting
-- habits.created_by (email) directly. Now that (1) above guarantees
-- user_profiles.created_by always matches the real JWT email, this is
-- belt-and-suspenders -- but it removes the RPC's reliance on any email
-- column altogether, so a future regression in (1) can't reopen this
-- specific hole. Logic is otherwise unchanged from 20260813090001.
-- ============================================================
create or replace function public.get_challenge_member_progress(
  p_challenge_id uuid,
  p_elapsed_dates text[],
  p_today date
)
returns table(email text, completed_days integer, streak integer, no_matching_habit boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_email text := auth.jwt() ->> 'email';
  v_challenge public.group_challenges;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge
  from public.group_challenges
  where id = p_challenge_id;

  if v_challenge is null then
    raise exception 'Challenge not found';
  end if;

  -- Explicit authorization check -- SECURITY DEFINER means RLS on
  -- group_challenges was bypassed above, so this can't rely on RLS
  -- having already scoped visibility to the caller.
  if not (v_challenge.member_emails @> array[v_caller_email]) then
    raise exception 'Not a member of this challenge';
  end if;

  return query
  with members as (
    select unnest(v_challenge.member_emails) as member_email
  ),
  matching_habit as (
    select
      m.member_email,
      h.completions
    from members m
    left join public.user_profiles up on up.created_by = m.member_email
    left join lateral (
      select hh.completions
      from public.habits hh
      where hh.created_by_id = up.created_by_id
        and lower(hh.name) = lower(v_challenge.habit_name)
      limit 1
    ) h on up.created_by_id is not null
  ),
  challenge_window as (
    select
      mh.member_email,
      mh.completions,
      (
        select array_agg(c)
        from unnest(mh.completions) as c
        where c >= v_challenge.start_date::text and c <= v_challenge.end_date::text
      ) as challenge_completions
    from matching_habit mh
  )
  select
    cw.member_email,
    (
      select count(*)
      from unnest(p_elapsed_dates) as d
      where cw.completions is not null and d = any(cw.completions)
    )::integer as completed_days,
    case
      when cw.challenge_completions is null or array_length(cw.challenge_completions, 1) is null then 0
      else public.calculate_streak_from_dates(cw.challenge_completions, p_today)
    end as streak,
    cw.completions is null as no_matching_habit
  from challenge_window cw;
end;
$$;
