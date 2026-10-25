-- Two integration gaps where a feature's own data stopped agreeing with
-- the rest of the app.
--
-- ============================================================
-- 1. Archived habits and the profile stat columns
-- ============================================================
--
-- `archived` is honoured in six places -- get_partner_dashboard,
-- accountability_shared_habits, get_group_freeze_candidates,
-- get_challenge_member_progress, complete_habit_from_focus_session and the
-- share picker -- and in none of the four columns that feed every
-- leaderboard. sync_profile_stats_from_habits selects
-- `where h.created_by_id = new.created_by_id` with no archived filter at
-- all.
--
-- A blanket filter would be wrong, which is why this is not the one-line
-- change it looks like. The four stats have different relationships to
-- archiving:
--
--   * best_streak is explicitly the ALL-TIME best (GroupDashboard's
--     calcScore comment says so, and the leaderboard labels it "Best
--     Streak"). Excluding archived habits would retroactively erase a
--     record somebody actually set. Left inclusive.
--   * total_completions is historical in the same way -- and has zero
--     client consumers today; nothing reads it. Left inclusive.
--   * consistency_score is a 30-day window averaged across habits, so an
--     archived habit contributes 0% and DRAGS THE AVERAGE DOWN. Retiring
--     a habit you have stopped doing currently lowers your score. That is
--     the opposite of inflation and it is the clearest error of the four.
--   * last_completion_date is a recency signal read by other group
--     members (20261020090001 added it precisely so "the line under a
--     teammate's name is trustworthy"). A completion on a since-archived
--     habit makes somebody look like they are still showing up. Excluded.
--
-- So: historical stats keep every habit, forward-looking stats count only
-- habits the user still tracks.
--
-- Re-declared in full rather than patched, including `security definer`
-- and the owner re-assertion at the bottom -- both are what
-- protect_user_profiles_stats_fields recognises as a trusted write (see
-- 20260914090004's header), and the `exception when others` backstop so a
-- derived display stat can never abort the user's actual habit save.

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
    coalesce((select round(avg(pct)) from per_habit_consistency), 0),
    coalesce((select sum(array_length(completions, 1)) from owner_habits), 0),
    -- Left null (not defaulted to a day) when a user has no parseable
    -- completions on an active habit: null means "no completion on
    -- record", which the client states as such rather than implying a date.
    (select max(day) from active_days where day <= current_date)
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

-- Backfill, because the trigger only fires on a habit write. Without this
-- every existing row keeps its wrong value until that user next completes
-- something -- and an inactive user with a stale last_completion_date from
-- an archived habit is exactly the case worth correcting, since they are
-- the ones who will never trigger it.
--
-- SET LOCAL ROLE, not a plain UPDATE: protect_user_profiles_stats_fields
-- guards both columns and its only escape hatches are service_role and
-- current_user = 'profile_stats_sync_trusted'. A migration has neither by
-- default, so this write would be rejected. 20260914090004 granted that
-- role to the migration role and declared it NOINHERIT, which is precisely
-- the SET ROLE pattern. LOCAL so it reverts with the transaction.
set local role profile_stats_sync_trusted;

update public.user_profiles p
set consistency_score = coalesce(src.consistency, 0),
    last_completion_date = src.last_day
from (
  select
    u.created_by_id,
    (select round(avg(pct)) from (
      select (select count(*) from generate_series(0, 29) as i
              where (current_date - i)::text = any(h.completions))::numeric / 30 * 100 as pct
      from public.habits h
      where h.created_by_id = u.created_by_id
        and not coalesce(h.archived, false)
    ) per_habit) as consistency,
    (select max(d::date)
     from public.habits h, unnest(coalesce(h.completions, '{}'::text[])) as d
     where h.created_by_id = u.created_by_id
       and not coalesce(h.archived, false)
       and d ~ '^\d{4}-\d{2}-\d{2}$'
       and d <= current_date::text) as last_day
  from (select distinct created_by_id from public.user_profiles) u
) src
where src.created_by_id = p.created_by_id;

reset role;

-- ============================================================
-- 2. remove_group_member: removal that reaches the group's challenges
-- ============================================================
--
-- Removing someone from a group updated groups.member_emails and nothing
-- else, so they stayed on every active challenge's leaderboard -- with
-- progress -- in a group they had left. group_challenges.member_emails is
-- snapshotted at creation (CreateChallengeModal) and was never reconciled.
--
-- The precedent for reconciling it already exists and makes this an
-- inconsistency rather than an oversight: 20260914090003 states that "the
-- only real UPDATE path is sweep_deleted_user_references, which only ever
-- touches member_emails". Challenge membership IS swept when somebody
-- deletes their account. It just was not when they were removed.
--
-- Why an RPC rather than a second client write:
--   * group_challenges_update requires created_by_id = auth.uid(), i.e.
--     the CHALLENGE's creator. The remover is the GROUP's owner. The UI
--     gates challenge creation to the owner so those usually coincide, but
--     group_challenges_insert_own lets any authenticated member insert
--     one, so the UI gate is not the boundary -- and where they differ a
--     client update would match zero rows and silently succeed.
--   * Two sequential client writes can half-fail, leaving the same orphan
--     state this fixes, only narrower. One function is atomic.
--
-- Same shape as join_group (20260811090001), which exists for the mirror
-- reason: a non-member cannot UPDATE the groups row under RLS either.
create or replace function public.remove_group_member(p_group_id uuid, p_email text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_group public.groups;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if v_group is null then
    raise exception 'Group not found';
  end if;

  -- Mirrors groups_update's own predicate rather than inventing a second
  -- notion of who may administer a group.
  if v_group.created_by_id <> v_caller_id and not public.is_admin() then
    raise exception 'Only the group admin can remove members.';
  end if;

  -- The owner cannot remove themselves: groups_update would still let them
  -- through, but a group whose admin is not a member has no reachable
  -- settings. Deleting the group is the deliberate path for that.
  if p_email = v_group.created_by then
    raise exception 'The group admin cannot be removed. Delete the group instead.';
  end if;

  update public.groups
  set member_emails = array_remove(coalesce(member_emails, '{}'::text[]), p_email)
  where id = p_group_id
  returning * into v_group;

  -- The whole point of this function. Scoped to this group's challenges
  -- only, and array_remove is a no-op on rows that never contained them.
  update public.group_challenges
  set member_emails = array_remove(coalesce(member_emails, '{}'::text[]), p_email)
  where group_id = p_group_id
    and member_emails @> array[p_email];

  return v_group;
end;
$$;

revoke all on function public.remove_group_member(uuid, text) from public;
grant execute on function public.remove_group_member(uuid, text) to authenticated;
