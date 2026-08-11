-- Fix: user_profiles.best_streak / .consistency_score / .total_completions
-- have sat at their `default 0` since launch -- no code path anywhere in
-- the app has ever written them. They exist specifically to be the one
-- cross-user-readable source of another member's real stats (readable via
-- user_profiles_select's `is_public = true` clause, since habits itself
-- has no such clause -- see below), but nothing ever populated them.
--
-- GroupDashboard.jsx's group leaderboard worked around this by hardcoding
-- score/bestStreak/consistency to 0 for every member except the viewer,
-- which is the bug: each viewer computes their OWN real score from their
-- own live habits query and sees everyone else frozen at a fake 0 --
-- explaining why two different members of the same group each saw
-- themselves leading and everyone else at 0.
--
-- The deeper reason it was stubbed rather than queried directly: habits
-- RLS is strictly owner-only --
--   create policy "habits_select_own" on public.habits for select
--     using (created_by_id = auth.uid());
-- -- with no group-membership or admin clause at all, so no client can
-- ever read another user's habits rows to compute their score on the fly.
-- user_profiles is the only viable cross-user surface for this data, so
-- this migration wires it up: keep it in sync via a trigger on habits
-- writes, server-side, rather than trusting a client-submitted value.
--
-- Algorithm mirrors the client's own existing helpers exactly, so the
-- trigger-computed values match what Social.jsx's leaderboard tab (which
-- already reads these same columns) and the rest of the app expect:
--   - best_streak: longest-ever run of consecutive-day completions across
--     ALL of the owner's habits (same definition as getAllTimeBest() in
--     MilestoneBadges.jsx -- NOT calculateStreak()'s "current active
--     streak", which is a different metric GroupDashboard.jsx's own "me"
--     row used to use; that mismatch is fixed alongside this migration).
--   - consistency_score: for each habit, % of the last 30 calendar days
--     completed; averaged across all habits (same as calcConsistency(),
--     duplicated identically today in Social.jsx and GroupDashboard.jsx).
--   - total_completions: total check-ins ever, summed across all habits.
--
-- Known limitations, deliberately not addressed here:
--   - Fires on INSERT/UPDATE only (matches the requested scope) -- does
--     NOT fire on DELETE, so archiving/deleting a habit won't lower a
--     stale best_streak/consistency until another qualifying habits
--     write happens for that owner.
--   - Uses the database's current_date (UTC on Supabase), while the
--     client computes "today"/"last 30 days" in the viewer's own browser
--     timezone -- near midnight this can disagree by a day. No per-user
--     timezone is stored anywhere in this schema to correct for that.
--   - No column-level write protection is added here (unlike
--     user_profiles.plan/subscription_status/paddle_*): any authenticated
--     user can still directly overwrite their own best_streak/
--     consistency_score/total_completions via a plain client update
--     today. Low real risk right now (small private groups, no stakes
--     beyond visibly contradicting your own completion history), but
--     worth a dedicated follow-up once this data is actually load-bearing
--     for a leaderboard people care about gaming.
--
-- SECURITY INVOKER (the default -- no `security definer` here), same
-- reasoning as set_challenge_habit_name: habits_insert_own/update_own
-- already guarantee NEW.created_by_id = auth.uid() for any real write, so
-- this trigger's own UPDATE always targets the caller's own user_profiles
-- row, which user_profiles_update_own already permits. No column lockdown
-- exists yet on these three columns to fight with (only plan/
-- subscription_status/paddle_* are locked down), so INVOKER works cleanly
-- and gives the same defense-in-depth as elsewhere in this codebase: if
-- created_by_id ever somehow diverged from auth.uid(), RLS blocks the
-- write instead of a DEFINER function silently succeeding regardless.
create or replace function public.sync_profile_stats_from_habits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_best_streak integer;
  v_consistency numeric;
  v_total integer;
begin
  with owner_habits as (
    select h.id, coalesce(h.completions, '{}'::text[]) as completions
    from public.habits h
    where h.created_by_id = new.created_by_id
  ),
  distinct_days as (
    select distinct oh.id, d::date as day
    from owner_habits oh, unnest(oh.completions) as d
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
    coalesce((select sum(array_length(completions, 1)) from owner_habits), 0)
  into v_best_streak, v_consistency, v_total;

  update public.user_profiles
  set best_streak = v_best_streak,
      consistency_score = v_consistency,
      total_completions = v_total
  where created_by_id = new.created_by_id;

  return new;
end;
$$;

create trigger habits_sync_profile_stats
  after insert or update on public.habits
  for each row execute function public.sync_profile_stats_from_habits();

-- Backfill: force the trigger above to run once for every existing habit,
-- so today's real habit owners get real profile stats immediately instead
-- of waiting on their next habit write. No-op update (id = id) purely to
-- fire the AFTER UPDATE trigger; habits.updated_at isn't read anywhere in
-- the UI, so the side-effect bump is invisible. Reuses the trigger's own
-- computation rather than duplicating the algorithm in a separate
-- one-time script, so there's nothing to keep in sync or drift from.
update public.habits set id = id;
