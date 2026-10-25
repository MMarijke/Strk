-- Per-member habit resolution: the join tables, their write paths, and a
-- backfill. No read path changes here -- get_challenge_member_progress and
-- complete_habit_from_focus_session still name-match after this migration,
-- and are converted in the two PRs that follow. This one is additive and
-- independently verifiable.
--
-- ============================================================
-- Why this exists
-- ============================================================
--
-- Three places decide WHOSE habit counts by matching a name:
-- ChallengeLeaderboard.getStatsForMember, get_challenge_member_progress
-- (20260813090001) and complete_habit_from_focus_session (20261021090003).
-- A member who tracks the same thing under a different name shows 0%
-- forever, and a focus-session participant who tracks it at all was, until
-- 20261025090001, told it "was already done today".
--
-- The wall both of those migrations hit is real: habits_select_own is
-- strictly owner-only, so a creator can never reference another member's
-- habit. Both concluded a per-member join table was "a much larger
-- redesign" and deferred it.
--
-- That is overstated, and this codebase already disproves it:
-- get_group_freeze_candidates (20260915090003) returns
-- (member_email, habit_id, habit_name, missed_date) -- real per-member
-- resolution through a SECURITY DEFINER read -- and its own comment notes
-- get_challenge_member_progress uses the identical mechanism. The
-- mechanism is already shipped in both features. Only the matching key is
-- a name.
--
-- So the link becomes explicit and stored. A name match survives only as a
-- client-side PRE-SELECTION, which is possible because a joiner can always
-- read their own habits and the parent row already carries habit_name.
-- Every server-side name match goes away; nothing is ever inferred about
-- somebody else's data.
--
-- Roster and linkage stay separate concerns. member_emails remains the
-- roster -- "the whole group is in this" is the point of a group challenge
-- -- and these tables hold only which habit counts. A member without a
-- link reads "Not linked yet" with an action, never a silent 0%.
--
-- Two purpose-built tables rather than one polymorphic habit_links: a
-- polymorphic subject_id cannot carry a real foreign key, so cascade
-- cleanup would need triggers, and one table per concern is this
-- codebase's stated pattern (see accountability_nudges' own header).

-- ============================================================
-- challenge_habit_links
-- ============================================================
--
-- user_id AND user_email, matching the created_by_id/created_by duality
-- used across this schema. The uuid is what cascades on account deletion
-- (so sweep_deleted_user_references needs no change for these tables); the
-- email is what lets remove_group_member delete by email without a
-- user_profiles lookup that would silently match nothing for a member who
-- has no profile row.
--
-- habit_id is NOT NULL: unlinking deletes the row rather than nulling it,
-- so "no link" has exactly one representation.
--
-- on delete cascade on habit_id, unlike group_challenges.habit_id's
-- `restrict` -- that column DEFINES the challenge, this one only points at
-- a habit, and deleting a habit should return the member to "not linked"
-- rather than block the delete.
create table public.challenge_habit_links (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.group_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text not null,
  habit_id uuid not null references public.habits (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create index challenge_habit_links_challenge_idx
  on public.challenge_habit_links (challenge_id);

alter table public.challenge_habit_links enable row level security;

-- Select own only. A member never needs to read anyone else's link: the
-- progress RPC is SECURITY DEFINER and reads them all server-side, which
-- is the same narrow channel get_challenge_member_progress already is.
create policy "challenge_habit_links_select_own"
  on public.challenge_habit_links for select
  using (user_id = auth.uid());

-- No insert/update/delete policies at all. The RPCs below are the boundary
-- and the only place the validation lives -- a client that could insert
-- here directly could claim a habit it does not own for a challenge it is
-- not in. Same "absence of a policy IS the boundary" pattern as
-- accountability_partnerships and accountability_shared_habits.

-- ============================================================
-- focus_session_habit_links
-- ============================================================
create table public.focus_session_habit_links (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.focus_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text not null,
  habit_id uuid not null references public.habits (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index focus_session_habit_links_session_idx
  on public.focus_session_habit_links (session_id);

alter table public.focus_session_habit_links enable row level security;

create policy "focus_session_habit_links_select_own"
  on public.focus_session_habit_links for select
  using (user_id = auth.uid());

-- ============================================================
-- Keep the denormalised columns honest.
--
-- user_id/user_email are set from auth by the RPCs, and habit_id is
-- validated there too. This enforces what they promise rather than
-- trusting them: a future write path that passed someone else's habit, or
-- an email that does not belong to the user_id, would otherwise publish a
-- habit the linker does not own into a leaderboard.
--
-- SECURITY INVOKER (the default, stated by omission of `definer`): it only
-- reads habits to validate the new row and needs no elevated rights. Per
-- CLAUDE.md a SECURITY DEFINER trigger function resets current_user to its
-- own owner, so a guard that never needs that should not take it.
-- ============================================================
create or replace function public.protect_habit_link_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.habits h
    where h.id = new.habit_id
      and h.created_by_id = new.user_id
      and h.created_by = new.user_email
  ) then
    raise exception 'A habit link must point at a habit owned by the linking user';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_challenge_habit_link_owner_trigger on public.challenge_habit_links;
create trigger protect_challenge_habit_link_owner_trigger
  before insert or update on public.challenge_habit_links
  for each row execute function public.protect_habit_link_owner();

drop trigger if exists protect_focus_session_habit_link_owner_trigger on public.focus_session_habit_links;
create trigger protect_focus_session_habit_link_owner_trigger
  before insert or update on public.focus_session_habit_links
  for each row execute function public.protect_habit_link_owner();

-- ============================================================
-- link_challenge_habit: which of MY habits counts for this challenge.
--
-- A null p_habit_id unlinks, so one function covers both directions --
-- "set my selection" is the client's whole job and a lost request leaves
-- no half-state.
--
-- Refuses once the challenge has ended. Progress is then historical and a
-- member should not be able to rewrite a finished leaderboard.
-- ============================================================
create or replace function public.link_challenge_habit(p_challenge_id uuid, p_habit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_challenge public.group_challenges;
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge
  from public.group_challenges
  where id = p_challenge_id;

  if v_challenge is null then
    raise exception 'Challenge not found.';
  end if;

  -- The roster is still member_emails; this function does not change who
  -- is in a challenge, only which habit counts for them.
  if not v_challenge.member_emails @> array[v_caller_email] then
    raise exception 'You are not part of this challenge.';
  end if;

  if v_challenge.end_date is not null and v_challenge.end_date < current_date then
    raise exception 'This challenge has ended.';
  end if;

  if p_habit_id is null then
    delete from public.challenge_habit_links
    where challenge_id = p_challenge_id and user_id = v_caller_id;
    return;
  end if;

  -- Archived habits are refused: the dashboard filters them out, so
  -- linking one would leave the member believing they had linked something
  -- that can never register a completion.
  if not exists (
    select 1 from public.habits h
    where h.id = p_habit_id
      and h.created_by_id = v_caller_id
      and not coalesce(h.archived, false)
  ) then
    raise exception 'You can only link one of your own active habits.';
  end if;

  insert into public.challenge_habit_links (challenge_id, user_id, user_email, habit_id)
  values (p_challenge_id, v_caller_id, v_caller_email, p_habit_id)
  on conflict (challenge_id, user_id)
  do update set habit_id = excluded.habit_id, created_at = now();
end;
$$;

revoke all on function public.link_challenge_habit(uuid, uuid) from public;
grant execute on function public.link_challenge_habit(uuid, uuid) to authenticated;

-- ============================================================
-- link_focus_session_habit: the same, for a session.
--
-- Separate from join_focus_session deliberately, even though the lobby
-- will pass a habit on join (the PR that follows): a participant can
-- change their selection during the lobby without re-joining, and
-- join_focus_session is idempotent for an existing participant so it is
-- the wrong place to carry a changeable choice.
--
-- Refuses once the session is 'completed': complete_habit_from_focus_
-- session has already run by then, so a later link would change nothing
-- while appearing to.
-- ============================================================
create or replace function public.link_focus_session_habit(p_session_id uuid, p_habit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_session public.focus_sessions;
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session
  from public.focus_sessions
  where id = p_session_id;

  if v_session is null then
    raise exception 'Session not found.';
  end if;

  if not v_session.participant_emails @> array[v_caller_email] then
    raise exception 'You are not in this session.';
  end if;

  if v_session.status = 'completed' then
    raise exception 'This session has already ended.';
  end if;

  if p_habit_id is null then
    delete from public.focus_session_habit_links
    where session_id = p_session_id and user_id = v_caller_id;
    return;
  end if;

  if not exists (
    select 1 from public.habits h
    where h.id = p_habit_id
      and h.created_by_id = v_caller_id
      and not coalesce(h.archived, false)
  ) then
    raise exception 'You can only link one of your own active habits.';
  end if;

  insert into public.focus_session_habit_links (session_id, user_id, user_email, habit_id)
  values (p_session_id, v_caller_id, v_caller_email, p_habit_id)
  on conflict (session_id, user_id)
  do update set habit_id = excluded.habit_id, created_at = now();
end;
$$;

revoke all on function public.link_focus_session_habit(uuid, uuid) from public;
grant execute on function public.link_focus_session_habit(uuid, uuid) to authenticated;

-- ============================================================
-- Backfill the challenge links from the current name match.
--
-- These are exactly the rows whose progress counts today, so nobody's
-- visible progress changes when PR 2 switches the read path over. Members
-- who were already silently at 0% get no row, and will read "Not linked
-- yet" with an action instead.
--
-- Every challenge, not only in-flight ones: an ended challenge's
-- leaderboard is still viewable, and leaving those unlinked would rewrite
-- history into "nobody participated".
--
-- Two deliberate differences from what get_challenge_member_progress does
-- today, both of which are corrections rather than drift:
--
--   1. `not archived`. That RPC does NOT filter archived habits, while
--      complete_habit_from_focus_session does -- the same inconsistency
--      20261025090002 fixed for the profile stat columns, in a third
--      place. A member whose only matching habit is archived currently
--      shows progress and will now show "Not linked yet". That is a
--      visible, actionable state replacing a number drawn from a habit
--      they have retired.
--   2. A deterministic tie-break. That RPC uses `limit 1` with no ORDER
--      BY, so which habit wins when a member has two by the same name is
--      arbitrary today. `order by h.created_at` picks the oldest, matching
--      complete_habit_from_focus_session.
--
-- No role switching and no privilege games: this inserts into a table this
-- migration just created, selecting from tables the same migration role
-- owns, so RLS does not apply and no guard trigger is involved. That is
-- the difference from 20261025090002's backfill, which needed the
-- service_role claim because it wrote to a guarded pre-existing table.
insert into public.challenge_habit_links (challenge_id, user_id, user_email, habit_id)
select distinct on (gc.id, h.created_by_id)
  gc.id, h.created_by_id, h.created_by, h.id
from public.group_challenges gc
cross join unnest(gc.member_emails) as member_email
join public.habits h
  on h.created_by = member_email
 and not coalesce(h.archived, false)
 and lower(h.name) = lower(gc.habit_name)
order by gc.id, h.created_by_id, h.created_at
on conflict (challenge_id, user_id) do nothing;

-- ============================================================
-- remove_group_member also drops the removed member's links.
--
-- Cascading off the challenge cannot reach these -- the challenge is not
-- deleted, the member is. Leaving them would recreate a narrower version
-- of the orphan 20261025090002 fixed: somebody removed from a group,
-- gone from member_emails, but still holding a link that PR 2's read path
-- would surface.
--
-- Re-declared in full rather than patched so the whole authorisation path
-- stays readable in one place.
-- ============================================================
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

  -- Scoped to this group's challenges only, and array_remove is a no-op on
  -- rows that never contained them.
  update public.group_challenges
  set member_emails = array_remove(coalesce(member_emails, '{}'::text[]), p_email)
  where group_id = p_group_id
    and member_emails @> array[p_email];

  delete from public.challenge_habit_links
  where user_email = p_email
    and challenge_id in (
      select id from public.group_challenges where group_id = p_group_id
    );

  return v_group;
end;
$$;

revoke all on function public.remove_group_member(uuid, text) from public;
grant execute on function public.remove_group_member(uuid, text) to authenticated;
