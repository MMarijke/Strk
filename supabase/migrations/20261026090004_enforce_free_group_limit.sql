-- The free-plan group cap was the only Pro gate with no server enforcement.
--
-- Every other one is checked in the database: reactions
-- (20260811090005), custom challenge durations (20260915090002), streak
-- freezes (20260727090001), freeze assist and accountability partner
-- invites (20260915090003/4). 20260915090002's own header states the
-- principle -- "a raw client insert with a custom duration_days and no Pro
-- plan is rejected regardless of what the client UI allowed".
--
-- The group cap was enforced only in CreateGroupModal.jsx and
-- Social.jsx, so a plain supabase.from('groups').insert(...) created an
-- unlimited number. The one gate anyone could bypass with a raw client
-- call was the one protecting the paid tier.
--
-- ============================================================
-- Grandfathering is the point, not a concession
-- ============================================================
--
-- The check is `>= 2` at INSERT time, which means a user already above
-- the cap keeps every group they have and simply cannot add another. A
-- Pro user who downgrades with five groups loses nothing they built. No
-- existing row is touched, archived or locked -- deleting a group
-- cascades to its challenges and would take away something other members
-- are actively using.
--
-- ============================================================
-- Counting the same way the client does
-- ============================================================
--
-- Social.jsx counts groups you own OR are a member of:
--
--   g.created_by === user?.email || (g.member_emails || []).includes(...)
--
-- so this mirrors that rather than counting only owned groups. Counting
-- ownership alone would make the server MORE permissive than the UI, and
-- the two disagreeing about what "2 groups" means is worse than either
-- rule on its own.
--
-- This deliberately does NOT cap joining. join_group has no equivalent
-- check, so a free user can still accept an invite into a third group --
-- blocking that would turn an invite into a dead end, and it is a
-- different product decision from "how many can you create".
--
-- current_email() rather than new.created_by: that column is a plain text
-- field with a default, not pinned by RLS the way created_by_id is
-- (groups_insert_own requires created_by_id = auth.uid()), so trusting it
-- would let a crafted insert supply someone else's email and dodge the
-- count entirely.
--
-- SECURITY INVOKER -- stated by omitting `definer`, matching
-- enforce_challenge_duration_plan_limit exactly. The trigger reads the
-- caller's own user_profiles row and their own groups, both of which
-- their RLS policies already permit, so it needs no elevated rights. Per
-- CLAUDE.md a DEFINER trigger resets current_user, and a guard that does
-- not need that should not take it.
--
-- Prose rather than a machine code, also matching
-- enforce_challenge_duration_plan_limit. The client has its own paywall
-- copy and reaches this only on a path the UI does not offer, so the
-- message is for whoever is reading the error, not for branching on.
-- ============================================================
create or replace function public.enforce_group_plan_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_pro boolean;
  v_email text := public.current_email();
  v_count integer;
begin
  select (plan = 'pro') into v_is_pro
  from public.user_profiles
  where created_by_id = new.created_by_id;

  if coalesce(v_is_pro, false) then
    return new;
  end if;

  select count(*) into v_count
  from public.groups g
  where g.created_by_id = new.created_by_id
     or (v_email is not null and g.member_emails @> array[v_email]);

  if v_count >= 2 then
    raise exception 'The free plan covers 2 groups. Upgrade to Pro for unlimited groups.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_group_plan_limit_trigger on public.groups;
create trigger enforce_group_plan_limit_trigger
  before insert on public.groups
  for each row execute function public.enforce_group_plan_limit();
