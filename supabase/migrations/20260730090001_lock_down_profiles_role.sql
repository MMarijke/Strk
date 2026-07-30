-- Security follow-up to 20260727090001: profiles.role has the same RLS
-- gap that user_profiles.plan/streak_freezes.used_count had — RLS only
-- restricts which ROW a user can update (id = auth.uid()), not which
-- COLUMN, so any authenticated user could self-promote via a plain
-- supabase.from('profiles').update({ role: 'admin' }).eq('id', <own id>)
-- call. is_admin() (used to gate broader group/challenge/focus-session
-- access) trusts this column, so this is a real privilege-escalation
-- path today, not just a hygiene issue.
--
-- Confirmed via codebase audit: there is no legitimate app path that
-- ever promotes a user to 'admin' — the only write to profiles.role is
-- handle_new_user() inserting 'user' at signup. Admin promotion is a
-- manual/dashboard-only operation, so unlike streak_freezes (which
-- needed a dedicated trusted RPC role for its own legitimate write
-- path), a plain service_role check is sufficient here.
--
-- This trigger only checks auth.role(), never current_user, so the
-- SECURITY DEFINER/INVOKER trap from the freeze_rpc_trusted work does
-- NOT apply here: that trap only breaks a current_user check (SECURITY
-- DEFINER resets current_user to the function's own owner), and this
-- function never reads current_user, so SECURITY DEFINER is safe as
-- written.
create or replace function public.protect_profiles_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.role is distinct from old.role
  ) and auth.role() is distinct from 'service_role' then
    raise exception 'role can only be changed by service_role — no in-app promotion path exists; this is a manual/dashboard-only operation';
  end if;
  return new;
end;
$$;

create trigger protect_profiles_role_trigger
  before update on public.profiles
  for each row execute function public.protect_profiles_role();
