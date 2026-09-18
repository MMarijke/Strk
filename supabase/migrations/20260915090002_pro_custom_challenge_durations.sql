-- Feature: Pro group creators can set any challenge duration; Free stays
-- limited to the existing 7/14/30 day presets. Two layers, matching this
-- project's established pattern of never trusting a client-supplied "isPro"
-- flag for a paid-feature gate (see apply_streak_freeze's own comment on
-- exactly this point):
--   1. Relax the CHECK constraint to a sane bound (still rejects nonsense
--      like 0, negative, or multi-year durations) instead of the fixed set.
--   2. A BEFORE INSERT trigger re-derives eligibility server-side from
--      user_profiles.plan -- a raw client insert with a custom duration_days
--      and no Pro plan is rejected regardless of what the client UI allowed.
--
-- SECURITY INVOKER (the default, no `security definer`) is deliberate, same
-- reasoning as set_challenge_habit_name (20260810090001): new.created_by_id
-- is already guaranteed to equal auth.uid() by group_challenges_insert_own,
-- so this trigger's own read of user_profiles for that same id is already
-- the caller's own row under user_profiles_select's RLS -- no elevated
-- privilege is needed, and INVOKER keeps that RLS check as a second,
-- independent layer instead of bypassing it.
alter table public.group_challenges
  drop constraint if exists group_challenges_duration_days_check;

alter table public.group_challenges
  add constraint group_challenges_duration_days_check check (duration_days > 0 and duration_days <= 365);

create or replace function public.enforce_challenge_duration_plan_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_pro boolean;
begin
  if new.duration_days not in (7, 14, 30) then
    select (plan = 'pro') into v_is_pro
    from public.user_profiles
    where created_by_id = new.created_by_id;

    if not coalesce(v_is_pro, false) then
      raise exception 'Custom challenge durations are a Pro feature. Free groups can choose 7, 14, or 30 days.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_challenge_duration_plan_limit_trigger
  before insert on public.group_challenges
  for each row execute function public.enforce_challenge_duration_plan_limit();

-- Vuln fix (caught in review before this ever shipped): the gate above only
-- fires on INSERT. group_challenges_update (20260914090003) lets the owner
-- update any column of their own row, and the relaxed CHECK constraint
-- above accepts any 1-365 value regardless of plan -- so a Free user could
-- create a 7-day challenge, then call
-- `supabase.from('group_challenges').update({ duration_days: 365 })` on
-- their own row directly, fully bypassing the Pro gate with nothing in
-- between to stop it.
--
-- Re-deriving Pro status on every UPDATE (mirroring the insert trigger)
-- would create a worse bug: a challenge legitimately created while Pro,
-- then touched by an unrelated, ordinary update after the creator's plan
-- lapses (e.g. member_emails changing when someone joins the group -- the
-- only real UPDATE path today per 20260914090003's own comment), would
-- retroactively fail and block that unrelated write. Pinning duration_days
-- immutable after creation avoids that entirely and matches the exact
-- precedent 20260914090003 already set for habit_id/habit_name, for the
-- identical reason: no legitimate client path updates it today.
create or replace function public.preserve_group_challenges_duration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.duration_days := old.duration_days;
  return new;
end;
$$;

create trigger preserve_group_challenges_duration_trigger
  before update on public.group_challenges
  for each row execute function public.preserve_group_challenges_duration();
