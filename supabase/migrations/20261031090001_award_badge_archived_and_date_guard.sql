-- award_badge: apply two fixes that never reached it, and guard a date cast.
--
-- ============================================================
-- 1. The archived-habit rule (20261025090002) skipped this function
-- ============================================================
--
-- 20261025090002 established the rule this codebase now follows in
-- sync_profile_stats_from_habits and src/lib/utils.js's calculateStats:
--
--   * a HISTORICAL achievement counts every habit, archived included,
--     because excluding retired habits would retroactively erase a record
--     somebody actually set;
--   * a FORWARD-LOOKING rate counts only habits still being tracked,
--     because an archived habit contributes 0% and drags the average down.
--
-- That migration never touched award_badge (`grep -c award_badge` on it
-- returns 0), and neither of this function's two previous versions ever
-- filtered `archived`. Three badges were on the wrong side of the rule:
--
--   consistency_king -- averaged archived habits into a 30-day rate, so a
--     user whose profile showed 85% could be refused a badge needing 80.
--     Its own comment claimed the formula was "identical" to the trigger's.
--
--   perfect_week, perfect_month -- these ask whether EVERY owned habit was
--     completed every day of a window. An archived habit has no
--     completions in any recent window, so including it meant a single
--     archived habit permanently locked both badges, for good, with no
--     way for the user to tell why.
--
-- The streak badges and comeback_kid deliberately keep counting every
-- habit: those are historical, and that side of the rule was already
-- right. first_step and collector also keep counting every habit ever
-- created -- archiving one of five habits should not take Collector away,
-- and src/lib/badgeDefinitions.js counts the same way on the client.
--
-- The zero-habit guards move to a new v_active_habit_count for exactly the
-- three badges above. Reusing v_habit_count would have been a bug: with
-- the archived filter in place, a user tracking nothing has no habit that
-- can be missing a completion, so perfect_week's `not exists` becomes
-- vacuously TRUE and awards a perfect week for an empty account.
--
-- src/lib/badgeDefinitions.js is changed in the same commit, so the badge
-- a user is shown and the badge the server will grant stay in agreement.
--
-- ============================================================
-- 2. The date-cast fix (20260915090001) also skipped this function
-- ============================================================
--
-- 20260915090001 exists because casting every element of
-- habits.completions to `date` throws for the WHOLE array if any single
-- entry is not a valid date literal -- legacy data, an old import -- and
-- it then throws on every call from then on, not only when a bad value is
-- being written. Its own header lists award_badge's consistency window as
-- a place already safe, because that compares as text.
--
-- Its streak block is not. `distinct_days` casts `d::date` with no guard,
-- and so does comeback_kid, and this function has no `exception when
-- others` backstop the way the trigger does -- so one malformed legacy
-- date means no streak badge, ever, surfaced as a hard RPC failure.
--
-- Both now carry the same `d ~ '^\d{4}-\d{2}-\d{2}$'` filter the trigger
-- uses in three places. A backstop handler is deliberately NOT added: the
-- trigger can warn-and-continue because it is a side-effect stats sync,
-- whereas swallowing an error here would silently not award a badge the
-- user had earned.
--
-- ============================================================
--
-- CREATE OR REPLACE is safe: same signature, same jsonb return type, so
-- no PostgREST overload and no drop/recreate needed.

create or replace function public.award_badge(p_badge_id text, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
  v_habit_count integer;
  v_active_habit_count integer;
  v_best_streak integer;
  v_required_days integer;
  v_eligible boolean := false;
  v_earned_date date := p_today;
  v_consistency numeric;
  v_has_perfect_week boolean;
  v_has_perfect_month boolean;
  v_has_comeback boolean;
  v_in_group boolean;
begin
  if v_user_id is null or v_user_email is null then
    raise exception 'Not authenticated';
  end if;

  if p_badge_id not in (
    'first_step', 'on_a_roll', 'week_warrior', 'fortnight_force', 'monthly_master',
    'century_club', 'collector', 'perfect_week', 'perfect_month', 'comeback_kid',
    'consistency_king', 'social_butterfly'
  ) then
    raise exception 'Unknown badge id: %', p_badge_id;
  end if;

  -- Idempotent: never overwrite an already-earned badge, matching the
  -- app's own "earned state never reverts" rule -- also makes this safe to
  -- call speculatively every time Badges.jsx detects a possible new earn.
  if exists (
    select 1 from public.user_badges
    where created_by_id = v_user_id and badge_id = p_badge_id
  ) then
    return jsonb_build_object('success', true, 'already_earned', true);
  end if;

  select count(*) into v_habit_count
  from public.habits
  where created_by_id = v_user_id;

  -- Habits the user still tracks. Separate from v_habit_count above
  -- because the two are needed for different badges: a historical
  -- achievement counts every habit ever created, a forward-looking rate
  -- counts only the ones still being tracked. See the header.
  select count(*) into v_active_habit_count
  from public.habits
  where created_by_id = v_user_id
    and coalesce(archived, false) = false;

  v_required_days := case p_badge_id
    when 'on_a_roll' then 3
    when 'week_warrior' then 7
    when 'fortnight_force' then 14
    when 'monthly_master' then 30
    when 'century_club' then 100
    else null
  end;

  -- All-time best run of consecutive-day completions across every habit the
  -- caller owns, and (for the specific threshold being checked) the
  -- earliest date that run first reached p_required_days -- same "longest
  -- run" gaps-and-islands technique already used server-side by
  -- sync_profile_stats_from_habits (20260811090002), recomputed fresh from
  -- live habits.completions here rather than trusted from the separately
  -- still-client-writable user_profiles.best_streak column. Mirrors
  -- badgeDefinitions.js's findStreakEarnedDate/getStreakBadgeEarnedDate:
  -- the first day within any qualifying run where its length reaches the
  -- threshold, earliest such day across all habits.
  if v_required_days is not null then
    with owner_habits as (
      select id, coalesce(completions, '{}'::text[]) as completions
      from public.habits
      where created_by_id = v_user_id
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
    run_lengths as (
      select id, grp, count(*) as run_length, min(day) as run_start
      from runs
      group by id, grp
    )
    select
      coalesce(max(run_length), 0)::integer,
      (min(run_start + (v_required_days - 1) * interval '1 day') filter (where run_length >= v_required_days))::date
    into v_best_streak, v_earned_date
    from run_lengths;

    v_eligible := v_best_streak >= v_required_days;
    if v_earned_date is null then
      v_earned_date := p_today;
    end if;
  end if;

  if p_badge_id = 'first_step' then
    v_eligible := v_habit_count >= 1;

  elsif p_badge_id = 'collector' then
    v_eligible := v_habit_count >= 5;

  elsif p_badge_id = 'perfect_week' then
    -- v_active_habit_count, not v_habit_count: the scan below asks whether
    -- any day in the window is missing a completion for a habit, so with
    -- zero active habits there is nothing to miss and `not exists` would
    -- be vacuously true -- awarding a perfect week to somebody tracking
    -- nothing.
    if v_active_habit_count = 0 then
      v_eligible := false;
    else
      -- Any 7-day window in the last ~9 weeks where every owned habit was
      -- completed every day -- mirrors evaluateBadges()'s offset 0..60 scan.
      select exists (
        select 1
        from generate_series(0, 60) as off(offset_val)
        where not exists (
          select 1
          from public.habits h, generate_series(0, 6) as di(day_val)
          where h.created_by_id = v_user_id
            and coalesce(h.archived, false) = false
            and not ((p_today - off.offset_val - di.day_val)::text = any(coalesce(h.completions, '{}'::text[])))
        )
      ) into v_has_perfect_week;
      v_eligible := v_has_perfect_week;
    end if;

  elsif p_badge_id = 'perfect_month' then
    -- Active count, for the same vacuous-truth reason as perfect_week.
    if v_active_habit_count = 0 then
      v_eligible := false;
    else
      -- Any of the last 6 calendar months (same ~30-day-step reference
      -- points as evaluateBadges()) where every owned habit was completed
      -- every day of that month.
      select exists (
        select 1
        from (
          select
            date_trunc('month', (p_today - (m_val * 30)))::date as month_start,
            (date_trunc('month', (p_today - (m_val * 30))) + interval '1 month' - interval '1 day')::date as month_end
          from generate_series(0, 5) as g(m_val)
        ) months
        where not exists (
          select 1
          from public.habits h,
            generate_series(months.month_start::timestamp, months.month_end::timestamp, interval '1 day') as day(day_val)
          where h.created_by_id = v_user_id
            and coalesce(h.archived, false) = false
            and not (day.day_val::date::text = any(coalesce(h.completions, '{}'::text[])))
        )
      ) into v_has_perfect_month;
      v_eligible := v_has_perfect_month;
    end if;

  elsif p_badge_id = 'comeback_kid' then
    -- "Ever used a freeze" checked against the real streak_freezes ledger
    -- (any month, used_count > 0) rather than badgeDefinitions.js's client
    -- helper, which only ever inspected the CURRENT month's record.
    select exists (
      select 1 from public.streak_freezes
      where created_by_id = v_user_id and coalesce(used_count, 0) > 0
    ) into v_has_comeback;

    if not v_has_comeback then
      -- Missed exactly 1 day then resumed: two consecutive distinct
      -- completion dates on the same habit exactly 2 calendar days apart.
      select exists (
        select 1
        from (
          select id, coalesce(completions, '{}'::text[]) as completions
          from public.habits
          where created_by_id = v_user_id
        ) hb,
        lateral (
          select day, day - lag(day) over (order by day) as gap
          from (
            select distinct d::date as day
            from unnest(hb.completions) as d
            where d ~ '^\d{4}-\d{2}-\d{2}$'
          ) sub
        ) g
        where g.gap = 2
      ) into v_has_comeback;
    end if;
    v_eligible := v_has_comeback;

  elsif p_badge_id = 'consistency_king' then
    if v_active_habit_count = 0 then
      v_eligible := false;
    else
      -- Per-habit % of the last 30 calendar days completed, averaged --
      -- the same formula as sync_profile_stats_from_habits's
      -- consistency_score, recomputed fresh here rather than trusted from
      -- that column.
      --
      -- `not archived` is the correction. The claim that this was already
      -- "identical" to that function was false from the moment
      -- 20261025090002 taught the trigger to average only habits the user
      -- still tracks: that migration never touched this function, so a
      -- user could be shown 85% consistency on their profile and refused
      -- consistency_king at a threshold of 80, because this averaged in
      -- habits they had retired.
      with owner_habits as (
        select coalesce(completions, '{}'::text[]) as completions
        from public.habits
        where created_by_id = v_user_id
          and coalesce(archived, false) = false
      ),
      per_habit as (
        select
          (select count(*) from generate_series(0, 29) as i
           where (p_today - i)::text = any(oh.completions))::numeric / 30 * 100 as pct
        from owner_habits oh
      )
      select round(avg(pct)) into v_consistency from per_habit;
      v_eligible := coalesce(v_consistency, 0) >= 80;
    end if;

  elsif p_badge_id = 'social_butterfly' then
    select exists (
      select 1 from public.groups
      where created_by_id = v_user_id
         or member_emails @> array[v_user_email]
    ) into v_in_group;
    v_eligible := v_in_group;
  end if;

  if not v_eligible then
    return jsonb_build_object('success', false, 'reason', 'Not eligible for this badge yet.');
  end if;

  -- on conflict do nothing: the only change in this redefinition.
  --
  -- user_badges_owner_badge_key (created_by_id, badge_id) already made a
  -- double award impossible, but the bare insert turned the collision into
  -- a raised exception. The already-earned check above is a plain
  -- `if exists`, so two concurrent calls -- two tabs, or a remount firing
  -- the same evaluation pass twice -- can both pass it under MVCC and both
  -- reach here. One then failed, surfacing an error for a badge that was
  -- in fact awarded.
  --
  -- Exactly the race 20260914090006 had to go back and fix for
  -- send_reaction, whose own header documents the same count-then-insert
  -- visibility gap. Swallowing the conflict is correct here rather than
  -- merely convenient: the row already exists with the same
  -- (created_by_id, badge_id), earned state never reverts in this app, and
  -- the caller's 'success' is true either way -- which is the truth, since
  -- the badge is earned.
  insert into public.user_badges (created_by_id, user_email, badge_id, earned_date)
  values (v_user_id, v_user_email, p_badge_id, v_earned_date)
  on conflict (created_by_id, badge_id) do nothing;

  return jsonb_build_object('success', true, 'already_earned', false, 'earned_date', v_earned_date);
end;
$$;

revoke all on function public.award_badge(text, date) from public;
grant execute on function public.award_badge(text, date) to authenticated;
