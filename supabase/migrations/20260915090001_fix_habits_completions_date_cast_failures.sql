-- Bug fix: 20260914090005's reject_future_habit_completions() cast every
-- element of habits.completions to `date` (`d::date > v_max_allowed_date`)
-- to compare it. If ANY entry in a habit's completions array -- not just
-- the newly-added one -- isn't a strictly valid date literal (pre-existing/
-- legacy data, an old import, anything that predates this trigger), that
-- cast throws for the WHOLE array, on every single update to that habit
-- from then on, not just when a genuinely future date is being added. This
-- is what broke "complete a habit" for real users: the write that used to
-- work now fails every time, because some unrelated entry already sitting
-- in that habit's completions can't be cast, not because of what's newly
-- being written.
--
-- Fix: compare as text instead of casting to date. ISO 'YYYY-MM-DD'
-- strings already sort correctly under plain lexicographic (text) ordering,
-- so this still correctly catches a genuinely future date being added,
-- without ever attempting to parse -- and therefore without ever being
-- able to throw on -- a pre-existing malformed entry elsewhere in the
-- array. Same text-comparison approach already used safely elsewhere in
-- this codebase (get_challenge_member_progress's date-range filter,
-- award_badge's consistency window, send-weekly-digest).
create or replace function public.reject_future_habit_completions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max_allowed_date text := (current_date + 1)::text;
begin
  if new.completions is not null and exists (
    select 1 from unnest(new.completions) as d
    where d > v_max_allowed_date
  ) then
    raise exception 'habits.completions cannot include a date more than one day in the future';
  end if;
  return new;
end;
$$;

-- Second instance of the exact same class of bug, more severe: this AFTER
-- trigger (20260811090002, security-definer'd in 20260914090004) casts
-- every completion of EVERY habit the writer owns to `date` on every
-- single habits write, to compute best_streak/consistency_score/
-- total_completions. Being an AFTER trigger, an exception here rolls back
-- the write it's reacting to -- so one bad/legacy entry in ANY of a user's
-- habits broke saving ANY of their habits, not just the one with bad data.
--
-- Two independent fixes, both needed:
--   1. Filter to well-formed 'YYYY-MM-DD' strings before casting (regex
--      pre-check), so the common cases (empty strings, stray text, an old
--      non-ISO format) never reach `::date` at all.
--   2. Wrap the whole computation in an exception handler as a backstop.
--      Derived display stats (a leaderboard number) must never be able to
--      block the write they're derived from, even for a bad-data shape
--      the regex doesn't anticipate -- on any unexpected error this now
--      logs a warning and leaves best_streak/consistency_score/
--      total_completions unchanged for this write, rather than aborting
--      the user's actual save.
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
    coalesce((select sum(array_length(completions, 1)) from owner_habits), 0)
  into v_best_streak, v_consistency, v_total;

  update public.user_profiles
  set best_streak = v_best_streak,
      consistency_score = v_consistency,
      total_completions = v_total
  where created_by_id = new.created_by_id;

  return new;
exception when others then
  raise warning 'sync_profile_stats_from_habits: skipped stats update for created_by_id=% due to %', new.created_by_id, sqlerrm;
  return new;
end;
$$;

alter function public.sync_profile_stats_from_habits() owner to profile_stats_sync_trusted;
