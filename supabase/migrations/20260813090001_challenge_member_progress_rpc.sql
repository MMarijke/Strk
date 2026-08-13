-- ChallengeLeaderboard.jsx's per-other-member habit fetch (useQueries,
-- one Habit.filter({created_by: email}) per member) always returned
-- empty under RLS -- habits_select_own is strictly owner-only, no
-- group-membership exception -- so every non-"me" row showed "No
-- matching habit" regardless of real progress. Same root wall as the
-- group leaderboard/weekly-digest bugs, but this one can't be fixed the
-- same way: best_streak/consistency_score/last_week_completion_rate are
-- all "one value per user", recomputed on a write trigger or a weekly
-- cron. Challenge progress is keyed by (challenge, member) -- a user can
-- be in several groups each with their own active challenge -- and it
-- has to move even when nothing is written (elapsedDays grows by one
-- every day purely from the calendar advancing, with zero new
-- completions). A write-triggered recompute would go stale the moment a
-- day passes without that member touching their habit; a cron could
-- re-anchor it daily but stacks a second unverified cron dependency on
-- top of send-weekly-digest's already-unconfirmed schedule, for
-- something that's actually cheap to just compute live.
--
-- So: no persisted cache, no cron -- a read-only SECURITY DEFINER RPC
-- computing every member's progress fresh on each view. Read-only means
-- none of the column-lockdown-trigger/BYPASSRLS complexity the
-- delete-account migration needed applies here -- confirmed habits is
-- owned by postgres (the default migration role) with no FORCE ROW
-- LEVEL SECURITY set, so a function owned by that same default role
-- bypasses habits_select_own naturally, the same mechanism
-- join_group/send_reaction already rely on for groups/reactions. No new
-- role, no new grants.
--
-- p_elapsed_dates/p_today are client-supplied, not computed here, on
-- purpose: this makes the function a pure "match completions against
-- this exact date list" operation with no date arithmetic of its own,
-- eliminating any client/server timezone-boundary mismatch by
-- construction -- the same class of issue accepted as an unavoidable
-- limitation for send-weekly-digest's UTC-vs-browser-local "today" is
-- fixed here instead of just flagged, since this is read-only/cosmetic
-- display data, not enforcement-relevant like the reaction daily limit.
--
-- Faithfully replicates today's client matching behavior, not a silent
-- improvement: matches habits.name case-insensitively regardless of
-- archived status, same as getStatsForMember in ChallengeLeaderboard.jsx
-- does today. Whether archived habits should count toward a challenge is
-- a separate product question, not decided as a side effect of this fix.

-- ============================================================
-- calculate_streak_from_dates: StreakWidget.jsx's calculateStreak()
-- ported to SQL -- distinct from the all-time-best-run algorithm already
-- ported for sync_profile_stats_from_habits (20260811090002), which has
-- no "must include today/yesterday" recency requirement. Mirrors the JS
-- exactly: dedupe + sort descending, the most recent date must be
-- p_today or p_today - 1 or the streak is 0, then walk backwards
-- counting while each date is exactly one day before the previous.
-- ============================================================
create or replace function public.calculate_streak_from_dates(p_dates text[], p_today date)
returns integer
language plpgsql
immutable
as $$
declare
  v_dates date[];
  v_streak integer := 1;
  i integer;
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    return 0;
  end if;

  select array_agg(d order by d desc)
  into v_dates
  from (select distinct d::date as d from unnest(p_dates) as d) sub;

  if v_dates[1] <> p_today and v_dates[1] <> p_today - 1 then
    return 0;
  end if;

  for i in 2..array_length(v_dates, 1) loop
    if v_dates[i] = v_dates[i - 1] - 1 then
      v_streak := v_streak + 1;
    else
      exit;
    end if;
  end loop;

  return v_streak;
end;
$$;

-- ============================================================
-- get_challenge_member_progress: for every member of the given
-- challenge, returns completed_days (count of p_elapsed_dates present in
-- their matching habit's completions -- mirrors getStatsForMember's
-- completedDays, checked against the full completions array, not
-- date-range-filtered) and streak (calculate_streak_from_dates applied
-- to completions filtered to the challenge's own [start_date, end_date]
-- window -- mirrors getStatsForMember's challengeCompletions, a
-- deliberately different, WIDER window than p_elapsed_dates). pct is not
-- returned -- it's pure arithmetic (completed_days / elapsedDays) the
-- client already computes correctly with no data dependency.
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
    select m.member_email, h.completions
    from members m
    left join lateral (
      select h.completions
      from public.habits h
      where h.created_by = m.member_email
        and lower(h.name) = lower(v_challenge.habit_name)
      limit 1
    ) h on true
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

revoke all on function public.calculate_streak_from_dates(text[], date) from public;
grant execute on function public.calculate_streak_from_dates(text[], date) to authenticated;

revoke all on function public.get_challenge_member_progress(uuid, text[], date) from public;
grant execute on function public.get_challenge_member_progress(uuid, text[], date) to authenticated;
