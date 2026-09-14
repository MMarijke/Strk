-- Security fix: user_profiles.best_streak / consistency_score /
-- total_completions (20260811090002) and last_week_completion_rate /
-- prev_week_completion_rate / last_week_top_habit_name /
-- last_week_top_habit_count (20260811090004) were never covered by the
-- column-lockdown trigger pattern that already protects plan/
-- subscription_status/paddle_* -- 20260811090002 self-flagged this as an
-- open gap ("any authenticated user can still directly overwrite... low
-- real risk right now"). That's no longer true: Badges.jsx uses
-- best_streak/consistency_score for "Top X%" claims, and group
-- leaderboards read all of these for other members -- a plain
-- supabase.from('user_profiles').update({ best_streak: 99999, ... }) lets
-- any user top every leaderboard and falsely claim top-rank status
-- indefinitely.
--
-- The four last_week_*/prev_week_* columns are only ever written by
-- send-weekly-digest, which connects as service_role -- the existing
-- `auth.role() is distinct from 'service_role'` escape hatch (same as the
-- billing-fields trigger) covers them directly.
--
-- best_streak/consistency_score/total_completions are different: they're
-- written by sync_profile_stats_from_habits, a trigger that runs as
-- whichever authenticated user's habits write fired it (SECURITY INVOKER,
-- the default) -- auth.role() for that write is 'authenticated', same as
-- any direct client update, so auth.role() alone can't tell them apart.
-- Same shape of problem the freeze_rpc_trusted work already solved for
-- streak_freezes: give the sync trigger a dedicated NOLOGIN owner role and
-- have the guard check current_user for that specific role instead.
--
-- The SECURITY DEFINER/INVOKER trap applies here exactly as documented in
-- 20260727090001: sync_profile_stats_from_habits itself must become
-- SECURITY DEFINER (so current_user becomes profile_stats_sync_trusted for
-- the duration of its own UPDATE); the guard trigger checking current_user
-- must stay SECURITY INVOKER so it actually sees that value rather than
-- resetting current_user to its own owner.

create role profile_stats_sync_trusted noinherit nologin;
grant profile_stats_sync_trusted to current_user;
grant usage on schema public to profile_stats_sync_trusted;
grant create on schema public to profile_stats_sync_trusted;
grant select on public.habits to profile_stats_sync_trusted;
grant update on public.user_profiles to profile_stats_sync_trusted;

-- Re-declared identically to 20260811090002's version except for
-- `security definer` -- see file header for why that flip is required.
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

alter function public.sync_profile_stats_from_habits() owner to profile_stats_sync_trusted;

-- ============================================================
-- Guard trigger: rejects a direct write to any of the seven stat/rank
-- columns unless the caller is service_role (send-weekly-digest, for the
-- four last_week_*/prev_week_* columns) or the sync trigger's own trusted
-- role (for best_streak/consistency_score/total_completions).
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
    raise exception 'best_streak, consistency_score, total_completions, and the last-week stat fields can only be modified by sync_profile_stats_from_habits() or the weekly digest job, not directly';
  end if;
  return new;
end;
$$;

create trigger protect_user_profiles_stats_fields_trigger
  before update on public.user_profiles
  for each row execute function public.protect_user_profiles_stats_fields();
