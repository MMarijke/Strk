-- Security fix: 20260810090001 validated habit_id ownership and derived
-- habit_name server-side, but only via a BEFORE INSERT trigger + insert-
-- time WITH CHECK. group_challenges_update had no WITH CHECK at all beyond
-- row ownership, and nothing re-validated habit_id/habit_name on update --
-- so a challenge creator could later .update() habit_id to point at ANY
-- real habit (including another user's, since only the FK was checked, not
-- ownership) and/or set habit_name to an arbitrary mismatched string,
-- fully defeating 20260810090001's point and letting them rig their own
-- group's challenge after the fact.
--
-- No legitimate client path ever updates habit_id or habit_name today
-- (confirmed: GroupChallenge.update() is never called anywhere in the
-- app -- CreateChallengeModal only ever .create()s; the only real UPDATE
-- path is sweep_deleted_user_references, which only ever touches
-- member_emails). So rather than re-running the derivation trigger on
-- update (which would also silently desync habit_name from the frozen
-- snapshot taken at creation -- the whole point of that column, per
-- 20260810090001's own comment -- the moment the linked habit is ever
-- renamed), both columns are simply pinned immutable after creation, same
-- "preserve on update" pattern used for created_by in the previous
-- migration.
create or replace function public.preserve_group_challenges_habit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.habit_id := old.habit_id;
  new.habit_name := old.habit_name;
  return new;
end;
$$;

create trigger preserve_group_challenges_habit_fields_trigger
  before update on public.group_challenges
  for each row execute function public.preserve_group_challenges_habit_fields();

-- Explicit WITH CHECK, matching the insert policy's ownership condition --
-- previously implicit (Postgres reuses USING as WITH CHECK when none is
-- given), now stated outright so a future edit to USING can't silently
-- also loosen what's allowed to land in the updated row.
drop policy if exists "group_challenges_update" on public.group_challenges;
create policy "group_challenges_update" on public.group_challenges for update
  using (created_by_id = auth.uid() or is_admin())
  with check (created_by_id = auth.uid() or is_admin());
