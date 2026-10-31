-- Age-weight the consistency denominator.
--
-- consistency_score is the mean, across a user's active habits, of each
-- habit's completion rate over the last 30 calendar days. The denominator
-- was always 30, including for a habit that had existed for one day.
--
-- A habit created today and completed today was kept 1 day out of 1. At
-- /30 it reads 3.33%, and because consistency is a mean across habits,
-- adding that habit to one perfect 50-day habit does this (verified
-- against the live functions, not estimated):
--
--   before   consistency 100, score 2*50 + 100 = 200   -> Inferno
--   after    consistency  52, score 2*50 +  52 = 152   -> Blaze
--
-- A 48-point drop and a full tier demotion, with no warning, as the
-- immediate consequence of tracking something new -- the single action
-- this product most wants. It also ran the Dashboard progress bar
-- backwards with nothing to explain why, and because highest_rank is
-- written upward-only (Dashboard.jsx), re-earning the lost tier would
-- never celebrate again.
--
-- The penalty is independent of the tier rework: it exists under any
-- weighting of the two terms, and a multiplier would make it worse (at
-- 1.5x the same -48 becomes -72), so this lands first.
--
-- ============================================================
-- The window
-- ============================================================
--
--   greatest(1, least(30, (today - created_at::date) + 1))
--
-- Inclusive of the creation day, so a habit created today has a window of
-- 1 rather than 0 -- a 0 would divide by zero. Capped at 30 so nothing
-- changes for an established habit. Floored at 1 so clock skew, or a
-- created_at somehow in the future, cannot produce a zero or negative
-- denominator.
--
-- generate_series now runs over the habit's own window instead of a fixed
-- 0..29. That is also what keeps the rate honest in a case this app really
-- produces: completions can PREDATE created_at, because Edit Completions
-- lets a user backfill (SmartReminders.jsx documents the same situation).
-- Counting five backfilled days against a 1-day window would report 500%.
-- Counting only days inside the window means the numerator can never
-- exceed the denominator, so no clamp is needed.
--
-- ============================================================
-- Both functions, together
-- ============================================================
--
-- sync_profile_stats_from_habits writes consistency_score, and
-- award_badge recomputes the same quantity fresh for consistency_king
-- rather than trusting that column. Changing one without the other would
-- put them back out of step -- a user shown 100% on their profile and
-- refused a badge at a threshold of 80 -- which is precisely the defect
-- 20261031090001 was written to fix. They are redefined in one migration
-- for that reason.
--
-- award_badge measures its window against p_today, the caller's own local
-- date, because that is already how its consistency window works; the
-- trigger uses current_date. That difference is pre-existing and
-- deliberate, not introduced here.
--
-- src/lib/utils.js (calculateStats, habitWindowDays),
-- src/lib/badgeDefinitions.js (evaluateBadges) and src/pages/Trends.jsx
-- change in the same commit, so client and server never disagree about a
-- user's consistency.
--
-- One consequence worth recording, because it inverts an earlier comment:
-- evaluateBadges used to POOL (total completions / total slots) with a
-- comment arguing pooling and per-habit averaging are "the same number --
-- sum(k_i)/(n*30) either way". That held only while every denominator was
-- 30. With per-habit windows, sum(k_i)/sum(w_i) is not the mean of
-- k_i/w_i, so the client has been switched to a per-habit average to match
-- award_badge's round(avg(pct)).
--
-- Neither function changes signature or return type, so CREATE OR REPLACE
-- is safe: no PostgREST overload, no drop and recreate.

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
  v_rolling_best integer;
begin
  with owner_habits as (
    select h.id,
           coalesce(h.completions, '{}'::text[]) as completions,
           coalesce(h.archived, false) as archived,
           -- Days this habit has existed, inclusive of its creation day and
           -- capped at 30. This is its consistency denominator; see the
           -- migration header for why a fixed 30 was a defect.
           greatest(1, least(30, (current_date - h.created_at::date) + 1)) as window_days
    from public.habits h
    where h.created_by_id = new.created_by_id
  ),
  -- Historical: every habit, archived or not.
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
  -- Current form: the same islands technique, but only over days inside
  -- the trailing 90-day window. A run that began 120 days ago and is still
  -- going therefore reads as 90, which is the cap by construction.
  --
  -- Archived habits are deliberately INCLUDED here, unlike consistency
  -- below. This measures whether the user actually showed up on those
  -- days -- a historical fact about the window, not a projection -- so
  -- retiring the habit afterwards should not erase the days. The decay is
  -- the window moving on, not the archive flag.
  recent_days as (
    select distinct oh.id, d::date as day
    from owner_habits oh, unnest(oh.completions) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
      and d::date > current_date - 90
      and d::date <= current_date
  ),
  recent_runs as (
    select id, day,
           day - (row_number() over (partition by id order by day))::integer * interval '1 day' as grp
    from recent_days
  ),
  per_habit_recent as (
    select id, count(*) as run_length
    from recent_runs
    group by id, grp
  ),
  -- Forward-looking: only habits the user still tracks.
  active_habits as (
    select id, completions, window_days from owner_habits where not archived
  ),
  active_days as (
    select distinct ah.id, d::date as day
    from active_habits ah, unnest(ah.completions) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  per_habit_consistency as (
    select ah.id,
      -- generate_series over the habit's OWN window, not a fixed 0..29.
      -- Counting only days inside the window also means a completion that
      -- predates created_at (Edit Completions permits backfilling) cannot
      -- push the rate above 100.
      (select count(*) from generate_series(0, ah.window_days - 1) as i
       where (current_date - i)::text = any(ah.completions))::numeric
        / ah.window_days * 100 as pct
    from active_habits ah
  )
  select
    coalesce((select max(run_length) from per_habit_best), 0),
    coalesce((select max(run_length) from per_habit_recent), 0),
    coalesce((select round(avg(pct)) from per_habit_consistency), 0),
    coalesce((select sum(array_length(completions, 1)) from owner_habits), 0),
    -- Left null (not defaulted to a day) when a user has no parseable
    -- completions on an active habit: null means "no completion on
    -- record", which the client states as such rather than implying a date.
    (select max(day) from active_days where day <= current_date)
  into v_best_streak, v_rolling_best, v_consistency, v_total, v_last_completion;

  update public.user_profiles
  set best_streak = v_best_streak,
      rolling_best_streak_90 = v_rolling_best,
      consistency_score = v_consistency,
      total_completions = v_total,
      last_completion_date = v_last_completion
  where created_by_id = new.created_by_id;

  -- Witness rides the user's OWN write. See the header: recomputing it
  -- from a trigger on somebody else's table would need to read rows this
  -- caller cannot see, and the trusted roles have no BYPASSRLS.
  perform public.recompute_witness_slots(new.created_by_id, new.created_by);

  return new;
exception when others then
  raise warning 'sync_profile_stats_from_habits: skipped stats update for created_by_id=% due to %', new.created_by_id, sqlerrm;
  return new;
end;
$$;

alter function public.sync_profile_stats_from_habits() owner to profile_stats_sync_trusted;

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
        select coalesce(completions, '{}'::text[]) as completions,
               -- Same per-habit window as sync_profile_stats_from_habits,
               -- measured against p_today rather than current_date because
               -- the caller supplies their own local date here.
               greatest(1, least(30, (p_today - created_at::date) + 1)) as window_days
        from public.habits
        where created_by_id = v_user_id
          and coalesce(archived, false) = false
      ),
      per_habit as (
        select
          (select count(*) from generate_series(0, oh.window_days - 1) as i
           where (p_today - i)::text = any(oh.completions))::numeric
            / oh.window_days * 100 as pct
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

-- ============================================================
-- Backfill consistency_score
-- ============================================================
-- The trigger only fires on a habit write, so without this every existing
-- row keeps the /30 value until that user next completes something. That
-- matters because consistency_score is what OTHER members read for a
-- leaderboard row -- a user wrongly sitting at 52 would be ranked on 52 by
-- everyone else -- and because the users who never fire the trigger are
-- exactly the dormant ones.
--
-- Same service_role claim hatch as 20261031090002, not SET ROLE: that role
-- is noinherit nologin with no BYPASSRLS, so `set local role` leaves RLS in
-- force with auth.uid() NULL and the UPDATE matches zero rows while
-- succeeding silently. CI caught that once on this project already.
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);

  with owner_habits as (
    select h.created_by_id,
           h.id,
           coalesce(h.completions, '{}'::text[]) as completions,
           greatest(1, least(30, (current_date - h.created_at::date) + 1)) as window_days
    from public.habits h
    where coalesce(h.archived, false) = false
  ),
  per_habit as (
    select oh.created_by_id,
           (select count(*) from generate_series(0, oh.window_days - 1) as i
            where (current_date - i)::text = any(oh.completions))::numeric
             / oh.window_days * 100 as pct
    from owner_habits oh
  ),
  per_user as (
    select created_by_id, round(avg(pct)) as consistency
    from per_habit
    group by created_by_id
  )
  update public.user_profiles p
  set consistency_score = pu.consistency
  from per_user pu
  where p.created_by_id = pu.created_by_id
    and p.consistency_score is distinct from pu.consistency;

  -- A user whose only habits are archived has no row in per_user at all,
  -- so the UPDATE above cannot reach them. Their honest consistency is 0 --
  -- the same answer calculateStats gives for an empty active list -- and
  -- leaving a stale non-zero value there would keep crediting a rate for
  -- habits they have retired.
  update public.user_profiles p
  set consistency_score = 0
  where p.consistency_score is distinct from 0
    and not exists (
      select 1 from public.habits h
      where h.created_by_id = p.created_by_id
        and coalesce(h.archived, false) = false
    );
end;
$$;

-- ============================================================
-- Verification for the production apply
-- ============================================================
-- Preview branches are disabled on this project, so none of this SQL has
-- run anywhere when the PR goes green. Worth checking by hand:
--
--   -- Habits younger than 30 days should now rate well above old/30 math.
--   select h.name,
--          (current_date - h.created_at::date) + 1 as window_days,
--          cardinality(h.completions) as completions
--   from public.habits h
--   where coalesce(h.archived, false) = false
--     and h.created_at > now() - interval '30 days'
--   order by h.created_at desc
--   limit 20;
--
--   select count(*) filter (where consistency_score = 0) as at_zero,
--          count(*) filter (where consistency_score > 0) as above_zero,
--          max(consistency_score) as highest
--   from public.user_profiles;
--
-- highest must be <= 100. A value above 100 would mean a numerator escaped
-- its window, which is the specific failure the window slice prevents.
