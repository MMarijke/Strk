-- award_badge: make the insert conflict-safe.
--
-- One behavioural change, and it is the insert's conflict handling. The
-- ~200 lines of server-side eligibility logic below are EXTRACTED VERBATIM
-- from 20260914090002 by a script rather than retyped, so they are
-- byte-identical apart from that one block. Hand-copying a SECURITY
-- DEFINER function that gates permanent state is how a transcription slip
-- becomes a real bug, and the diff of this file against 20260914090002 is
-- meant to be readable as exactly one change.
--
-- Everything 20260914090002's header says still applies: eligibility is
-- recomputed server-side from the caller's own live rows rather than
-- trusted from the client's evaluateBadges() pass, and the residual gap it
-- names (habits.completions is still client-writable, so fabricated
-- completions can still legitimately "earn" a badge from this function's
-- point of view) is unchanged and still out of scope.
--
-- The badge-id whitelist stays duplicated between this function and
-- src/lib/badgeDefinitions.js -- there is no badges table to be the single
-- source, and inventing one for twelve static strings would be worse than
-- the duplication. src/lib/badgeIds.test.js now parses the whitelist out
-- of the newest migration that defines award_badge and asserts it matches
-- the client's ids, so drift fails a test instead of failing at runtime
-- with "Unknown badge id".

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
    if v_habit_count = 0 then
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
            and not ((p_today - off.offset_val - di.day_val)::text = any(coalesce(h.completions, '{}'::text[])))
        )
      ) into v_has_perfect_week;
      v_eligible := v_has_perfect_week;
    end if;

  elsif p_badge_id = 'perfect_month' then
    if v_habit_count = 0 then
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
          from (select distinct d::date as day from unnest(hb.completions) as d) sub
        ) g
        where g.gap = 2
      ) into v_has_comeback;
    end if;
    v_eligible := v_has_comeback;

  elsif p_badge_id = 'consistency_king' then
    if v_habit_count = 0 then
      v_eligible := false;
    else
      -- Per-habit % of the last 30 calendar days completed, averaged --
      -- identical formula to sync_profile_stats_from_habits's
      -- consistency_score, recomputed fresh here rather than trusted from
      -- that column.
      with owner_habits as (
        select coalesce(completions, '{}'::text[]) as completions
        from public.habits
        where created_by_id = v_user_id
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
