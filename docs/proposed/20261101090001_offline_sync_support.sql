-- PROPOSED, NOT APPLIED.
--
-- Deliberately NOT in supabase/migrations/. Database migrations are
-- applied by Supabase's own GitHub integration on push to main, so a file
-- sitting in that directory is a file that runs the moment this merges --
-- which is the opposite of "proposed". A prefix in the filename was the
-- first attempt and is not good enough to bet a production schema on.
--
-- To take it: move it into supabase/migrations/ with this timestamp, and
-- watch the apply. The offline layer currently shipping works WITHOUT any
-- of this; nothing here is load-bearing for what is already merged.
--
-- Three separate changes, independently useful, in rough order of how
-- much they matter.
--
-- ============================================================
-- 1. client_updated_at -- the conflict clock
-- ============================================================
--
-- THE PROBLEM. Conflict resolution is last-write-wins by `updated_at`,
-- and `updated_at` is wrong for the job. `set_updated_at`
-- (20260702120001) is a BEFORE UPDATE trigger calling now(), so the
-- column records when a row reached Supabase, not when the user edited
-- it.
--
-- A check-in made offline on Monday and pushed on Wednesday therefore
-- carries Wednesday's stamp, and BEATS a genuine Tuesday edit made on
-- another device. The later edit loses. Nothing in the client can fix
-- that, because the client never gets to set the column.
--
-- This affects scalar fields only. `habits.completions` is already immune
-- because the sync engine merges it per member rather than by row -- see
-- OFFLINE.md -- so the realistic blast radius today is a habit renamed on
-- two devices.
--
-- THE FIX. A column the touch-trigger does not touch, written by the
-- client at edit time, used as the conflict clock in place of
-- `updated_at`.
--
-- It must stay CLIENT-WRITABLE. Do not add it to
-- protect_user_profiles_stats_fields: unlike rolling_best_streak_90 and
-- witness_slots, which are server-derived and guarded precisely so a
-- client cannot forge a leaderboard position, this one is meaningless
-- unless the client sets it. Forging it lets a user win their own
-- conflicts, which is not an attack on anybody else.
alter table public.habits
  add column if not exists client_updated_at timestamptz;

alter table public.user_profiles
  add column if not exists client_updated_at timestamptz;

-- The pull cursor's query is `where <owner> = me and <clock> > cursor`.
-- Without this it is a sequential scan per sync, per user.
create index if not exists habits_owner_client_updated_idx
  on public.habits (created_by_id, client_updated_at);

create index if not exists user_profiles_owner_client_updated_idx
  on public.user_profiles (created_by_id, client_updated_at);

-- Backfill so existing rows sort sensibly rather than as NULL, which
-- would make every pre-existing row lose every conflict.
update public.habits
set client_updated_at = updated_at
where client_updated_at is null;

update public.user_profiles
set client_updated_at = updated_at
where client_updated_at is null;

-- ============================================================
-- 2. Atomic set-member operations
-- ============================================================
--
-- The sync engine currently applies a completion add/remove as a
-- read-modify-write: read the array, union the member, write it back. It
-- is safe for the case that matters (two devices adding different days)
-- because it re-reads at push time, and it verifies the write took and
-- retries if not.
--
-- The residual race is two pushes interleaving between the read and the
-- write, which needs both devices online within the same few hundred
-- milliseconds. These RPCs close it: array_append and array_remove inside
-- a single statement are atomic, and both are idempotent on a set.
--
-- SECURITY INVOKER (the default) deliberately. These must run as the
-- CALLER so habits_update_own still applies -- a DEFINER version owned by
-- a privileged role would let any authenticated user append a completion
-- to somebody else's habit.
create or replace function public.habit_completion_add(
  p_habit_id uuid,
  p_day text
)
returns void
language sql
set search_path = public
as $$
  update public.habits
  set completions = (
    select array_agg(distinct d order by d)
    from unnest(array_append(coalesce(completions, '{}'::text[]), p_day)) as d
  )
  where id = p_habit_id
    and p_day ~ '^\d{4}-\d{2}-\d{2}$';
$$;

create or replace function public.habit_completion_remove(
  p_habit_id uuid,
  p_day text
)
returns void
language sql
set search_path = public
as $$
  update public.habits
  set completions = array_remove(coalesce(completions, '{}'::text[]), p_day)
  where id = p_habit_id;
$$;

revoke all on function public.habit_completion_add(uuid, text) from public;
revoke all on function public.habit_completion_remove(uuid, text) from public;
grant execute on function public.habit_completion_add(uuid, text) to authenticated;
grant execute on function public.habit_completion_remove(uuid, text) to authenticated;

-- ============================================================
-- 3. Soft delete -- NOT included, and why
-- ============================================================
--
-- The brief asked for `deleted_at` on every mirrored table. It is
-- deliberately absent here, because it is not one column:
--
--   * Every read path in the app would need a `deleted_at is null`
--     filter, or the RLS select policies would have to carry it. Twenty
--     tables, forty-six query call sites.
--   * habits_delete_own and every other *_delete_own policy becomes dead
--     code that still grants a hard delete, so the two paths would
--     diverge silently.
--   * sync_profile_stats_from_habits, award_badge,
--     get_challenge_member_progress and send-weekly-digest all read
--     habits without any such filter and would start counting deleted
--     rows.
--
-- The offline layer works without it: a local delete pushes a real
-- DELETE, and pull reconciles rows deleted elsewhere with one id-only
-- query per table (see pullTable). That query is the cost of not having
-- soft delete, and it is a cheap one at this scale.
--
-- If soft delete is wanted, do it as its own change, scoped to `habits`
-- first, with the read filter added in the same commit as the column.
--
-- ============================================================
-- Verification after applying
-- ============================================================
--
--   select count(*) filter (where client_updated_at is null) as unstamped,
--          count(*) as total
--   from public.habits;
--   -- unstamped must be 0 after the backfill.
--
--   -- The guard must still reject a direct write to a derived column,
--   -- i.e. adding client_updated_at must not have widened the hatch:
--   update public.user_profiles set rolling_best_streak_90 = 9999
--   where created_by_id = auth.uid();
--   -- must raise.
--
--   select public.habit_completion_add('<a habit you own>', '2026-11-01');
--   select public.habit_completion_add('<a habit you own>', '2026-11-01');
--   -- twice: completions must contain the day exactly once.
--
--   select public.habit_completion_add('<a habit you do NOT own>', '2026-11-01');
--   -- must affect 0 rows, because the function is SECURITY INVOKER and
--   -- habits_update_own applies. If it succeeds, the function was created
--   -- as DEFINER by mistake.
