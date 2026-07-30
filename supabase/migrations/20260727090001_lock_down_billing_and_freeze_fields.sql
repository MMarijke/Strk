-- Security audit finding: RLS on user_profiles and streak_freezes only
-- restricts which ROWS a user can update (created_by_id = auth.uid()),
-- not which COLUMNS — so any authenticated user could self-grant Pro
-- (user_profiles.plan) or reset their own freeze usage (streak_freezes.
-- used_count / frozen_habits) via a plain supabase.from(...).update()
-- call, with no server-side check involved at all.
--
-- Fix: BEFORE UPDATE triggers that compare OLD vs NEW on just the
-- sensitive columns and reject the write unless the caller is trusted.
-- RLS bypass (BYPASSRLS on service_role) does NOT skip triggers —
-- triggers always fire — so this is a real, independent enforcement
-- layer, not redundant with RLS.

-- ============================================================
-- user_profiles: plan / subscription_status / paddle_* are webhook-only
-- ============================================================
-- The webhook (paddle-webhook/index.ts) connects with the real
-- SUPABASE_SERVICE_ROLE_KEY, so its own PostgREST request genuinely
-- carries a service_role JWT — auth.role() correctly reports
-- 'service_role' for that path with no extra plumbing needed here.
create or replace function public.protect_user_profiles_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.plan is distinct from old.plan
    or new.subscription_status is distinct from old.subscription_status
    or new.paddle_subscription_id is distinct from old.paddle_subscription_id
    or new.paddle_customer_id is distinct from old.paddle_customer_id
    or new.paddle_price_id is distinct from old.paddle_price_id
  -- IS DISTINCT FROM, not !=: auth.role() is NULL for any connection with
  -- no JWT context at all (e.g. a raw superuser psql session) -- plain !=
  -- against NULL evaluates to NULL, which PL/pgSQL treats as false in an
  -- IF condition, silently ALLOWING the update. Fail closed instead: no
  -- proven service_role means blocked, full stop.
  ) and auth.role() is distinct from 'service_role' then
    raise exception 'plan, subscription_status, and paddle_* fields can only be modified by service_role (the Paddle webhook)';
  end if;
  return new;
end;
$$;

create trigger protect_user_profiles_billing_fields_trigger
  before update on public.user_profiles
  for each row execute function public.protect_user_profiles_billing_fields();

-- ============================================================
-- streak_freezes: used_count / frozen_habits are RPC-only
-- ============================================================
-- apply_streak_freeze() below is called BY an authenticated user, not a
-- genuine service_role connection — even though it's SECURITY DEFINER,
-- auth.role() still reflects the original caller's JWT ('authenticated'),
-- not the function owner, so checking auth.role() alone wouldn't let the
-- RPC's own write through.
--
-- Deliberately NOT using a settable GUC flag (e.g. set_config) for this:
-- `authenticated` already holds raw EXECUTE on pg_catalog.set_config
-- (it's PUBLIC-executable by default in Postgres), so a flag-based
-- bypass would depend entirely on PostgREST's exposed-schema config
-- never routing to pg_catalog — a real boundary today, but an external,
-- dashboard-configurable one, not something this migration controls.
--
-- Instead: a dedicated, NOLOGIN role owns *only* apply_streak_freeze().
-- SECURITY DEFINER unconditionally makes current_user equal the
-- function's owner for the duration of its execution — a core Postgres
-- guarantee, not a convention — so nothing reachable from the client API
-- can ever produce this current_user value outside that function's own
-- execution.
create role freeze_rpc_trusted noinherit nologin;
-- ALTER FUNCTION ... OWNER TO requires the executing role to itself be a
-- member of the target role — not automatic just from having created it.
-- Grant membership to whichever role runs this migration so the ownership
-- change below succeeds.
grant freeze_rpc_trusted to current_user;
grant usage on schema public to freeze_rpc_trusted;
grant select on public.user_profiles to freeze_rpc_trusted;
grant select, insert, update on public.streak_freezes to freeze_rpc_trusted;

create or replace function public.protect_streak_freezes_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.used_count is distinct from old.used_count
    or new.frozen_habits is distinct from old.frozen_habits
  )
    -- Same fail-closed reasoning as the user_profiles trigger: IS DISTINCT
    -- FROM, not !=, so a NULL auth.role() (no JWT context) blocks rather
    -- than silently passing. current_user is never NULL so it's unaffected
    -- either way, but kept consistent.
    and auth.role() is distinct from 'service_role'
    and current_user is distinct from 'freeze_rpc_trusted'
  then
    raise exception 'used_count and frozen_habits can only be modified via apply_streak_freeze(), not directly';
  end if;
  return new;
end;
$$;

create trigger protect_streak_freezes_fields_trigger
  before update on public.streak_freezes
  for each row execute function public.protect_streak_freezes_fields();

-- ============================================================
-- apply_streak_freeze(): the new server-side, authoritative write path
-- ============================================================
-- Determines is_pro itself from user_profiles.plan (never trusts a
-- client-supplied boolean — that was exactly the gap: freezeService.js
-- used to take isPro as a parameter and enforce the limit in JS only).
-- Upserts the caller's current-month row via ON CONFLICT so this also
-- closes a race with the read-side loadMonthRecord() creating the same
-- row concurrently.
--
-- RLS still applies to this role's queries (its policies aren't scoped
-- `to authenticated` only, so they apply to freeze_rpc_trusted too) —
-- but since every query here is scoped to v_user_id = auth.uid(), which
-- still resolves to the original caller regardless of the owner-role
-- switch, the existing owner-only policies are naturally satisfied. No
-- BYPASSRLS needed.
create or replace function public.apply_streak_freeze(p_habit_id uuid, p_missed_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
  v_is_pro boolean;
  v_month_key text := to_char(now(), 'YYYY-MM');
  v_record public.streak_freezes;
  v_free_limit constant integer := 2;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select (plan = 'pro') into v_is_pro
  from public.user_profiles
  where created_by_id = v_user_id
  limit 1;
  v_is_pro := coalesce(v_is_pro, false);

  insert into public.streak_freezes (created_by_id, user_email, month_key, used_count, frozen_habits)
  values (v_user_id, v_user_email, v_month_key, 0, '{}'::jsonb)
  on conflict (created_by_id, month_key) do update set created_by_id = excluded.created_by_id
  returning * into v_record;

  if v_record.frozen_habits ? p_habit_id::text then
    return jsonb_build_object('success', false, 'reason', 'Already used a freeze for this habit this month.');
  end if;

  if not v_is_pro and coalesce(v_record.used_count, 0) >= v_free_limit then
    return jsonb_build_object('success', false, 'reason', 'No freezes remaining this month. Upgrade to Pro for unlimited freezes.');
  end if;

  update public.streak_freezes
  set used_count = coalesce(v_record.used_count, 0) + 1,
      frozen_habits = coalesce(v_record.frozen_habits, '{}'::jsonb) || jsonb_build_object(p_habit_id::text, p_missed_date::text)
  where id = v_record.id
  returning * into v_record;

  return jsonb_build_object('success', true, 'record', to_jsonb(v_record));
end;
$$;

alter function public.apply_streak_freeze(uuid, date) owner to freeze_rpc_trusted;

revoke all on function public.apply_streak_freeze(uuid, date) from public;
grant execute on function public.apply_streak_freeze(uuid, date) to authenticated;
