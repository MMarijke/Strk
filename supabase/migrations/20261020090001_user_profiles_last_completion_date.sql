-- Group leaderboard honesty fix: GroupDashboard.jsx hardcoded
-- `topHabit: null` for every member other than "me", and rendered a
-- permanent "No habit data visible" line under their name. That slot
-- could never fill. habits_select_own (20260702120003) is strictly
-- owner-only with no group-membership exception, so another member's
-- habit rows -- and therefore their habit names and their habit count --
-- are structurally unreadable from any client session. The empty line was
-- not a missing fetch; it was a permanent property of the RLS model, and
-- every member saw it about every other member forever.
--
-- user_profiles is the only cross-user surface for this (the same
-- conclusion 20260811090002 and 20260813090001 each reached), and it
-- already carries best_streak / consistency_score / total_completions.
-- What it has no column for is recency: whether a member is still
-- showing up at all. That is the one signal that slot can honestly
-- carry, so this migration adds it.
--
-- Why a `date` called last_completion_date, and not a `last_active_at`
-- timestamptz: the value is derived from habits.completions, which is a
-- text[] of 'YYYY-MM-DD' day strings with no time-of-day component at
-- all. A timestamptz would invent a precision the source data does not
-- have. "Active" would also be the wrong word for it -- opening the app,
-- joining a focus session or reacting to a friend writes no completion --
-- so this column means exactly "the most recent day on which this user
-- completed any habit", and the UI says "completed", not "active".
--
-- GDPR/POPIA (per CLAUDE.md): last_completion_date is personal data
-- (activity metadata about an identifiable user). Retention: it exists
-- only as a single derived value on that user's own user_profiles row,
-- holds no history, is overwritten in place on each habits write, and
-- needs no separate erasure path -- user_profiles.created_by_id
-- references auth.users (id) on delete cascade, so account deletion
-- removes it with the profile. Visibility is already governed by the
-- existing user_profiles_select policy (own row, or is_public = true), so
-- a member with is_public = false shares no recency signal either; the
-- client renders honest "not shared" copy for that case rather than a
-- fabricated zero.

alter table public.user_profiles
  add column if not exists last_completion_date date;

-- One-time backfill from existing completion history, so the column is
-- meaningful for current users immediately instead of staying null until
-- each of them happens to write a habit again (the sync trigger fires on
-- habits INSERT/UPDATE only -- see 20260811090002's known limitations).
--
-- Deliberately sequenced BEFORE protect_user_profiles_stats_fields() is
-- extended to cover this column below: this statement runs as the
-- migration role, which is neither service_role nor
-- profile_stats_sync_trusted, so the extended guard would reject it. As
-- the guard stands at this point in the file it only fires on the seven
-- columns it already lists, none of which this statement touches.
--
-- The `d ~ '^\d{4}-\d{2}-\d{2}$'` pre-filter is the lesson of
-- 20260915090001: one malformed legacy entry anywhere in any user's
-- completions array must not be able to throw a `::date` cast for
-- everyone. The text upper bound discards far-future legacy entries
-- (reject_future_habit_completions only constrains writes made after
-- 20260914090005), which would otherwise backfill a day that has not
-- happened yet; ISO day strings compare correctly as plain text.
update public.user_profiles p
set last_completion_date = src.max_day
from (
  select h.created_by_id, max(d::date) as max_day
  from public.habits h,
       unnest(coalesce(h.completions, '{}'::text[])) as d
  where d ~ '^\d{4}-\d{2}-\d{2}$'
    and d <= current_date::text
  group by h.created_by_id
) src
where src.created_by_id = p.created_by_id;

-- ============================================================
-- Keep it in sync: the same trigger function that already computes the
-- other three stat columns. Re-declared identically to 20260915090001's
-- version except for the added last_completion_date computation and
-- assignment -- including `security definer` and the owner re-assertion
-- at the bottom, both of which protect_user_profiles_stats_fields()
-- depends on to recognise this write as trusted (see 20260914090004's
-- header for the DEFINER/INVOKER reasoning), and including the
-- `exception when others` backstop, so a derived display stat can never
-- abort the user's actual habit save.
-- ============================================================
create or replace function public.sync_profile_stats_from_habits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_best_streak integer;
  v_consistency numeric;
  v_total integer;
  v_last_completion date;
begin
  with owner_habits as (
    select h.id, coalesce(h.completions, '{}'::text[]) as completions
    from public.habits h
    where h.created_by_id = new.created_by_id
  ),
  distinct_days as (
    select distinct oh.id, d::date as day
    from owner_habits oh, unnest(oh.completions) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  runs as (
    select id, day,
           day - (row_number() over (partition by id order by day))::integer * interval '1 day' as grp
    from distinct_days
  ),
  per_habit_best as (
    select id, count(*) as run_length
    from runs
    group by id, grp
  ),
  per_habit_consistency as (
    select oh.id,
      (select count(*) from generate_series(0, 29) as i
       where (current_date - i)::text = any(oh.completions))::numeric / 30 * 100 as pct
    from owner_habits oh
  )
  select
    coalesce((select max(run_length) from per_habit_best), 0),
    coalesce((select round(avg(pct)) from per_habit_consistency), 0),
    coalesce((select sum(array_length(completions, 1)) from owner_habits), 0),
    -- Reuses distinct_days, which already applied the well-formed-date
    -- filter. Left null (not defaulted to a day) when a user has no
    -- parseable completions at all: null means "no completion on record",
    -- which the client states as such rather than implying a date.
    (select max(day) from distinct_days where day <= current_date)
  into v_best_streak, v_consistency, v_total, v_last_completion;

  update public.user_profiles
  set best_streak = v_best_streak,
      consistency_score = v_consistency,
      total_completions = v_total,
      last_completion_date = v_last_completion
  where created_by_id = new.created_by_id;

  return new;
exception when others then
  raise warning 'sync_profile_stats_from_habits: skipped stats update for created_by_id=% due to %', new.created_by_id, sqlerrm;
  return new;
end;
$$;

alter function public.sync_profile_stats_from_habits() owner to profile_stats_sync_trusted;

-- ============================================================
-- Extend the column-lockdown guard to cover last_completion_date.
--
-- This column is read by other group members and is exactly as spoofable
-- as best_streak was before 20260914090004 closed that gap: without this,
-- a plain supabase.from('user_profiles').update({ last_completion_date:
-- <today> }) would let any user keep looking like they are still showing
-- up daily long after they stopped. The entire point of the column is
-- that the line under a teammate's name is trustworthy, so it has to be
-- server-written only -- same reasoning, same two escape hatches, and the
-- same fail-closed IS DISTINCT FROM comparisons as the existing version.
-- ============================================================
create or replace function public.protect_user_profiles_stats_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.best_streak is distinct from old.best_streak
    or new.consistency_score is distinct from old.consistency_score
    or new.total_completions is distinct from old.total_completions
    or new.last_completion_date is distinct from old.last_completion_date
    or new.last_week_completion_rate is distinct from old.last_week_completion_rate
    or new.prev_week_completion_rate is distinct from old.prev_week_completion_rate
    or new.last_week_top_habit_name is distinct from old.last_week_top_habit_name
    or new.last_week_top_habit_count is distinct from old.last_week_top_habit_count
  )
    -- IS DISTINCT FROM, not !=: same fail-closed reasoning as the billing
    -- fields trigger -- a NULL auth.role() (no JWT context) must block,
    -- not silently pass.
    and auth.role() is distinct from 'service_role'
    and current_user is distinct from 'profile_stats_sync_trusted'
  then
    raise exception 'best_streak, consistency_score, total_completions, last_completion_date, and the last-week stat fields can only be modified by sync_profile_stats_from_habits() or the weekly digest job, not directly';
  end if;
  return new;
end;
$$;
