-- Witnessed tier system, step 1 of 2: the schema and the computation.
--
-- NOTHING READS THESE COLUMNS YET. That is deliberate. The formula switch
-- (rolling form instead of all-time best, and the witness multiplier) is a
-- separate migration and client change. Shipping the data first means
-- production is never in the half-state where the ladder has been
-- re-derived but the witness factor it depends on does not exist, which
-- would cap every user at Inferno and make the top tier unreachable for
-- everyone.
--
-- ============================================================
-- What is being added, and why
-- ============================================================
--
-- The tier score today is `all-time best streak * 2 + consistency`. Two
-- consequences, both measured against the live code:
--
--   * all-time best is monotone and consistency is capped at 100, so every
--     user's score is pinned inside [2b, 2b+100]. Past their peak the
--     number cannot move, whatever they do. A user whose best was 60 days
--     and who then runs perfect 20-day cycles forever is fixed at 220.
--   * the floor of 2b makes demotion below a record's tier impossible, so
--     a dormant ex-champion (200-day run, inactive a year) scores 400 and
--     outranks a newcomer who has been perfect for 30 days (160) by 240
--     points. On a product whose premise is progress witnessed by real
--     friends, the leaderboard ranked the absent above the present.
--
-- So: `rolling_best_streak_90` replaces all-time best as the form term,
-- and `witness_slots` records whether the user's habits were actually seen
-- by anybody. best_streak keeps its column and its all-time meaning --
-- it becomes the "Peak" record, which is also what the six streak badges
-- legitimately read, so award_badge needs no change.
--
-- ============================================================
-- Why witness is five booleans and not a count
-- ============================================================
--
-- witness_slots is five flags, each worth +10% in the client, maximum
-- +50%. It counts DISTINCT KINDS of being witnessed, never volume.
-- Volume is farmable -- a user could spam reactions at a friend and have
-- them spam back -- while breadth is not, because each slot is a
-- different feature with a different other person involved. It also makes
-- the breakdown renderable: five named rows, lit or unlit, where the unlit
-- ones double as discovery of social features the user has not tried.
--
-- The five, and the table each is derived from:
--
--   reacted   reactions.recipient_email, 30d       someone responded
--   session   focus_sessions, 30d, >1 participant  focused alongside someone
--   challenge group_challenges, active + in range  carrying a group challenge
--   assist    freeze_assists.assister_email, 90d   spent your own freeze on someone
--   partner   accountability_partnerships active   a live partner
--
-- freeze_assists is the one that matters most and was worth nothing
-- before: it is the only act in this schema that costs the giver
-- something for somebody else's benefit.
--
-- ============================================================
-- Why the recompute rides the user's own write
-- ============================================================
--
-- The obvious design is a trigger on each of those five tables. It does
-- not work here, and the reason is the trap 20261025090002 documented at
-- length: these trusted roles are created `noinherit nologin` with narrow
-- grants and NO BYPASSRLS, so RLS still applies inside a SECURITY DEFINER
-- function owned by one of them.
--
-- A reaction is INSERTed by the sender, and the row that needs
-- recomputing belongs to the RECIPIENT. Under the sender's JWT,
-- reactions_select (`sender_email = current_email() or recipient_email =
-- current_email()`) cannot see the recipient's other reactions -- so a
-- trigger there would compute the recipient's witness from a partial view
-- and quietly write a wrong, lower value. A silent no-op behind a green
-- tick, exactly as before.
--
-- Every one of the five tables, however, lets a user read their OWN side:
--   reactions                    recipient_email = current_email()
--   freeze_assists               assister_id = auth.uid() or target_id = auth.uid()
--   accountability_partnerships  requester_id = auth.uid() or partner_id = auth.uid()
--   focus_sessions, group_challenges   host/participant/member
--
-- So recompute_witness_slots is called for the ACTING user, under their
-- own JWT, from the habits trigger they already fire. auth.uid() and
-- auth.jwt() resolve to the caller inside a DEFINER function (they read
-- request.jwt.claims, not current_user), so RLS is satisfied rather than
-- fought.
--
-- The cost, stated rather than hidden: witness refreshes when the user
-- next writes a habit completion, so a user who receives a reaction and
-- does not open the app keeps a stale factor until they do. For an active
-- user that is same-day. Since the windows are 30 days, a stale factor
-- always decays LATE, never early -- it can over-credit briefly, never
-- under-credit. service_role bypasses RLS, so the weekly digest can sweep
-- dormant users; whether that is worth pg_cron is a later call.
--
-- ============================================================
-- Guard
-- ============================================================
--
-- Both new columns decide tier and leaderboard standing, so they join
-- protect_user_profiles_stats_fields. Without that, a plain
-- supabase.from('user_profiles').update({ rolling_best_streak_90: 9999,
-- witness_slots: {...all true} }) tops every leaderboard -- the same hole
-- 20260914090004 closed for best_streak.
--
-- The SECURITY DEFINER/INVOKER split is unchanged and still load-bearing:
-- the guard trigger stays SECURITY INVOKER so it sees who is really
-- calling, while the functions it protects are DEFINER and owned by
-- profile_stats_sync_trusted. A DEFINER guard would reset current_user to
-- its own owner and the check would fail permanently, even for the
-- legitimate write.

alter table public.user_profiles
  add column if not exists rolling_best_streak_90 integer not null default 0;

-- Five booleans. Defaulted to an empty object rather than all-false so a
-- never-computed row is distinguishable from a genuinely unwitnessed one:
-- the client reads a missing key as false either way, but a `{}` row in
-- the database says "not computed yet".
alter table public.user_profiles
  add column if not exists witness_slots jsonb not null default '{}'::jsonb;

-- ============================================================
-- The guard, re-declared with the two new columns
-- ============================================================
-- Identical to 20261020090001's version plus rolling_best_streak_90 and
-- witness_slots, keeping the same two escape hatches and the same
-- fail-closed IS DISTINCT FROM comparisons (a NULL auth.role(), i.e. any
-- connection with no JWT context, must block rather than silently pass).
create or replace function public.protect_user_profiles_stats_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.best_streak is distinct from old.best_streak
    or new.rolling_best_streak_90 is distinct from old.rolling_best_streak_90
    or new.witness_slots is distinct from old.witness_slots
    or new.consistency_score is distinct from old.consistency_score
    or new.total_completions is distinct from old.total_completions
    or new.last_completion_date is distinct from old.last_completion_date
    or new.last_week_completion_rate is distinct from old.last_week_completion_rate
    or new.prev_week_completion_rate is distinct from old.prev_week_completion_rate
    or new.last_week_top_habit_name is distinct from old.last_week_top_habit_name
    or new.last_week_top_habit_count is distinct from old.last_week_top_habit_count
  )
    and auth.role() is distinct from 'service_role'
    and current_user is distinct from 'profile_stats_sync_trusted'
  then
    raise exception 'best_streak, rolling_best_streak_90, witness_slots, consistency_score, total_completions, last_completion_date, and the last-week stat fields can only be modified by sync_profile_stats_from_habits()/recompute_witness_slots() or the weekly digest job, not directly';
  end if;
  return new;
end;
$$;

-- ============================================================
-- recompute_witness_slots
-- ============================================================
-- Writes the caller's five witness flags. SECURITY DEFINER and owned by
-- profile_stats_sync_trusted so the guard above lets the UPDATE through on
-- the current_user hatch; RLS on the five source tables still applies and
-- is satisfied by the caller's own JWT, which is the whole point (see
-- header).
--
-- Takes the identity explicitly rather than reading auth.uid() so the
-- weekly digest can sweep a specific user as service_role. Both arguments
-- are required: the uuid keys user_profiles and three of the source
-- tables, the email keys the other two, and this schema has no single
-- identifier that covers both.
create or replace function public.recompute_witness_slots(
  p_user_id uuid,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots jsonb;
begin
  if p_user_id is null or p_user_email is null then
    return null;
  end if;

  select jsonb_build_object(
    -- Somebody responded to your progress in the last 30 days.
    'reacted', exists (
      select 1 from public.reactions r
      where r.recipient_email = p_user_email
        and r.created_at >= now() - interval '30 days'
    ),
    -- You were in a focus session that was not just you. Counted over the
    -- host plus participants so a two-person session credits both, and
    -- distinct so a duplicated email in participant_emails cannot fake it.
    'session', exists (
      select 1 from public.focus_sessions fs
      where (fs.host_email = p_user_email or p_user_email = any(fs.participant_emails))
        and fs.started_at >= now() - interval '30 days'
        and (
          select count(distinct e)
          from unnest(array_append(coalesce(fs.participant_emails, '{}'::text[]), fs.host_email)) as e
          where e is not null
        ) >= 2
    ),
    -- You are carrying a group challenge that is live right now. No
    -- window needed: is_active plus the date range IS the window.
    'challenge', exists (
      select 1 from public.group_challenges gc
      where p_user_email = any(gc.member_emails)
        and coalesce(gc.is_active, false)
        and current_date between gc.start_date and gc.end_date
    ),
    -- You spent one of your own freezes to save someone else's streak.
    -- 90 days, not 30: it is rarer and costs the giver something, so it
    -- should not lapse as quickly as a reaction.
    'assist', exists (
      select 1 from public.freeze_assists fa
      where fa.assister_email = p_user_email
        and fa.created_at >= now() - interval '90 days'
    ),
    -- A live accountability partnership, either side.
    'partner', exists (
      select 1 from public.accountability_partnerships ap
      where ap.status = 'active'
        and (ap.requester_email = p_user_email or ap.partner_email = p_user_email)
    )
  ) into v_slots;

  update public.user_profiles
  set witness_slots = v_slots
  where created_by_id = p_user_id;

  return v_slots;
exception when others then
  -- Non-fatal, matching sync_profile_stats_from_habits's own backstop.
  -- Witness is a bonus multiplier: failing to refresh it must never block
  -- the habit completion that triggered the refresh. The stale value
  -- stands until the next write.
  raise warning 'recompute_witness_slots: skipped for % due to %', p_user_id, sqlerrm;
  return null;
end;
$$;

alter function public.recompute_witness_slots(uuid, text)
  owner to profile_stats_sync_trusted;

-- The owning role needs to read what it is counting. It already has
-- `select on habits` and `update on user_profiles` from 20260914090004.
grant select on public.reactions to profile_stats_sync_trusted;
grant select on public.focus_sessions to profile_stats_sync_trusted;
grant select on public.group_challenges to profile_stats_sync_trusted;
grant select on public.freeze_assists to profile_stats_sync_trusted;
grant select on public.accountability_partnerships to profile_stats_sync_trusted;
-- The UPDATE above also reads created_by_id in its WHERE.
grant select on public.user_profiles to profile_stats_sync_trusted;

revoke all on function public.recompute_witness_slots(uuid, text) from public;
grant execute on function public.recompute_witness_slots(uuid, text) to authenticated;
grant execute on function public.recompute_witness_slots(uuid, text) to service_role;

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
           coalesce(h.archived, false) as archived
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
    select id, completions from owner_habits where not archived
  ),
  active_days as (
    select distinct ah.id, d::date as day
    from active_habits ah, unnest(ah.completions) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  per_habit_consistency as (
    select ah.id,
      (select count(*) from generate_series(0, 29) as i
       where (current_date - i)::text = any(ah.completions))::numeric / 30 * 100 as pct
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

-- ============================================================
-- Backfill
-- ============================================================
-- The trigger only fires on a habit write, so without this every existing
-- row keeps rolling_best_streak_90 = 0 and witness_slots = '{}' until that
-- user next completes something. Step 2 switches the formula over, so an
-- unbackfilled row would read as score 0 / Ember for a user who is in fact
-- active -- and the users who would never fire the trigger are exactly the
-- dormant ones whose tier this redesign is meant to correct.
--
-- Takes the service_role hatch rather than SET ROLE, for the reason
-- 20261025090002 recorded after CI caught the alternative failing:
-- profile_stats_sync_trusted is `noinherit nologin` with narrow grants and
-- no BYPASSRLS, so `set local role` leaves RLS in force with auth.uid()
-- NULL -- the UPDATE would match zero rows and succeed silently. Setting
-- the JWT claim instead keeps the statement running as the migration role,
-- which owns these tables and so is not subject to their RLS, while
-- satisfying the guard's auth.role() hatch. SET LOCAL also cannot leak
-- past the transaction, unlike disabling the trigger.
do $$
declare
  r record;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);

  -- rolling_best_streak_90, computed exactly as the trigger does.
  with owner_habits as (
    select h.created_by_id, coalesce(h.completions, '{}'::text[]) as completions, h.id
    from public.habits h
  ),
  recent_days as (
    select distinct oh.created_by_id, oh.id, d::date as day
    from owner_habits oh, unnest(oh.completions) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
      and d::date > current_date - 90
      and d::date <= current_date
  ),
  recent_runs as (
    select created_by_id, id, day,
           day - (row_number() over (partition by created_by_id, id order by day))::integer * interval '1 day' as grp
    from recent_days
  ),
  per_habit as (
    select created_by_id, id, grp, count(*) as run_length
    from recent_runs
    group by created_by_id, id, grp
  ),
  per_user as (
    select created_by_id, max(run_length) as rolling_best
    from per_habit
    group by created_by_id
  )
  update public.user_profiles p
  set rolling_best_streak_90 = pu.rolling_best
  from per_user pu
  where p.created_by_id = pu.created_by_id
    and p.rolling_best_streak_90 is distinct from pu.rolling_best;

  -- witness_slots, for every profile that has an email to key the
  -- email-based slots off. recompute_witness_slots is DEFINER-owned by
  -- profile_stats_sync_trusted, but the claim set above means its own
  -- UPDATE passes the guard on the service_role hatch regardless.
  --
  -- A loop over a snapshot, not `perform f(...) from user_profiles`: that
  -- form has the function UPDATE-ing the very table the enclosing SELECT
  -- is still scanning. Postgres permits it and snapshot visibility makes
  -- it work, but a row-at-a-time loop states the intent and does not
  -- depend on that reasoning holding. The function's own `exception when
  -- others` means one unparseable row cannot abort the whole backfill.
  for r in
    select created_by_id, created_by
    from public.user_profiles
    where created_by is not null
  loop
    perform public.recompute_witness_slots(r.created_by_id, r.created_by);
  end loop;
end;
$$;

-- ============================================================
-- Verification notes for the production apply
-- ============================================================
-- Per-PR Supabase preview branches are disabled on this project, so this
-- SQL has not been executed anywhere when the PR goes green. Worth
-- checking by hand after the apply:
--
--   select count(*) filter (where rolling_best_streak_90 > 0) as with_form,
--          count(*) filter (where witness_slots <> '{}'::jsonb) as with_slots,
--          count(*) as total
--   from public.user_profiles;
--
-- with_slots should equal the number of profiles having a created_by.
-- with_form will be lower -- it is only non-zero for users with a
-- completion inside the trailing 90 days, which is the point.
--
--   select witness_slots, count(*)
--   from public.user_profiles group by 1 order by 2 desc;
--
-- A distribution where every row is all-false deserves suspicion: it would
-- mean the five EXISTS subqueries matched nothing, which on a database
-- with live groups and reactions would indicate the backfill ran without
-- the privileges it needed rather than a genuinely unsocial user base.
