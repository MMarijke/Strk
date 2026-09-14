-- Security fix: user_profiles.highest_rank is written directly by the
-- client (Dashboard.jsx) with no guard, same unprotected-column pattern as
-- the stats columns locked down in 20260914090004.
--
-- Lighter-touch fix than that migration's trusted-role scheme, deliberately:
-- confirmed via grep that highest_rank is never read anywhere except by its
-- own owner, on their own Dashboard, purely to decide whether to show a
-- one-time "you ranked up!" celebration modal -- unlike best_streak/
-- consistency_score, it's never displayed to or compared against other
-- users, so a full recompute-server-side-and-lock-to-a-trusted-role
-- pipeline (which would need porting calculateScore/getRank into SQL, for
-- a purely cosmetic, self-only flag) is disproportionate to the actual
-- risk. The only real misuse this enables is a user replaying or skipping
-- their own celebration modal -- harmless to anyone else.
--
-- What's still worth enforcing regardless of who's writing it: the value
-- must be one of the five real rank keys, and it must never move backward
-- (the whole point of "highest" reached). Both are cheap, self-contained
-- checks that need no service-role/trusted-role escape hatch at all.
create or replace function public.constrain_user_profiles_highest_rank()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rank_order text[] := array['ember', 'flame', 'blaze', 'inferno', 'legend'];
  v_old_idx integer;
  v_new_idx integer;
begin
  if new.highest_rank is distinct from old.highest_rank then
    if new.highest_rank is null then
      return new;
    end if;

    v_new_idx := array_position(v_rank_order, new.highest_rank);
    if v_new_idx is null then
      raise exception 'highest_rank must be one of %', v_rank_order;
    end if;

    v_old_idx := coalesce(array_position(v_rank_order, old.highest_rank), -1);
    if v_new_idx < v_old_idx then
      raise exception 'highest_rank cannot move backward (from % to %)', old.highest_rank, new.highest_rank;
    end if;
  end if;

  return new;
end;
$$;

create trigger constrain_user_profiles_highest_rank_trigger
  before update on public.user_profiles
  for each row execute function public.constrain_user_profiles_highest_rank();
