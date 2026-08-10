-- Fix: group_challenges.habit_name was free-text with zero validation --
-- any string could be submitted via CreateChallengeModal.jsx, including
-- a habit the creator doesn't own or that doesn't exist at all.
--
-- habit_id makes the creator's habit a real, validated foreign key.
-- habit_name stays, as a frozen snapshot taken at creation time -- same
-- precedent already used for challenge_notifications.habit_name, which
-- the 20260730090002 lockdown migration already treats as immutable
-- after creation.
--
-- Cross-member challenge matching (see ChallengeLeaderboard.jsx's
-- getStatsForMember) is untouched by this migration -- it matches by
-- name against EACH group member's own habits independently, which a
-- single habit_id (necessarily just the creator's habit) structurally
-- can't replace without a much larger redesign (a real per-member join
-- table). This migration closes "the creator didn't actually own the
-- referenced habit," not the broader per-member matching design.

-- One of the two existing rows has no habit matching its creator today:
-- id c85729dc-556c-4f7d-8291-dbae50fe09a5 ("Meditate for 10min",
-- created 2026-08-10). Deleted by exact id, not a heuristic -- only two
-- rows exist in this table at all. Already broken for its own creator
-- today (ChallengeLeaderboard already shows "No matching habit" for
-- them, same as it would show anyone else), so this removes nothing
-- that currently works for anyone. Confirmed with the table owner
-- before inclusion.
delete from public.group_challenges
where id = 'c85729dc-556c-4f7d-8291-dbae50fe09a5';

alter table public.group_challenges
  add column habit_id uuid references public.habits(id) on delete restrict;

-- Backfill the one remaining row via the same case-insensitive
-- name-match ChallengeLeaderboard.jsx already uses for cross-member
-- matching, scoped to the challenge's own creator.
update public.group_challenges gc
set habit_id = h.id
from public.habits h
where h.created_by_id = gc.created_by_id
  and lower(h.name) = lower(gc.habit_name);

alter table public.group_challenges
  alter column habit_id set not null;

-- ============================================================
-- RLS: the FK alone only proves habit_id references SOME real habit --
-- it says nothing about who owns it. A caller could otherwise submit a
-- real, valid habit_id belonging to a different user and the FK
-- wouldn't catch it. Extending the insert check closes that gap.
-- ============================================================
drop policy if exists "group_challenges_insert_own" on public.group_challenges;
create policy "group_challenges_insert_own" on public.group_challenges for insert
  with check (
    created_by_id = auth.uid()
    and exists (
      select 1 from public.habits h
      where h.id = habit_id and h.created_by_id = auth.uid()
    )
  );

-- ============================================================
-- habit_name is derived server-side from the real habit at insert time,
-- never trusted from the client -- even though the UI now only offers a
-- picker restricted to the caller's own habits (see
-- CreateChallengeModal.jsx), a raw API call could otherwise still send
-- a validated-real habit_id alongside an arbitrary, mismatched
-- habit_name string. This overwrites whatever the client sends with the
-- referenced habit's actual name.
--
-- Deliberately SECURITY INVOKER (the default -- no `security definer`
-- here), not because DEFINER would be wrong exactly, but because
-- INVOKER gives a second independent enforcement layer for free: this
-- SELECT runs under the calling user's own permissions, and
-- habits_select_own restricts it to rows they actually own. If a
-- non-owned habit_id ever reached this trigger despite the insert
-- policy above, the SELECT would see zero rows, habit_name would
-- resolve to null, and the pre-existing `not null` constraint on
-- habit_name would reject the insert outright -- fail closed, not
-- silently succeed with a wrong name.
-- ============================================================
create or replace function public.set_challenge_habit_name()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  select name into new.habit_name
  from public.habits
  where id = new.habit_id;
  return new;
end;
$$;

create trigger group_challenges_set_habit_name
  before insert on public.group_challenges
  for each row execute function public.set_challenge_habit_name();
