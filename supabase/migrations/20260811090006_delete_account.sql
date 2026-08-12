-- Fixes the account-deletion gap flagged in PRIVACY_POLICY.md §7: today
-- "Delete Account" only removes habits/user_profiles client-side, never
-- touches auth.users, and never cleans up the deleted user's email out of
-- other people's groups/challenges/sessions/reactions. Every table's
-- created_by_id already cascades off auth.users (on delete cascade,
-- confirmed exhaustively across all 10 app tables) -- calling the Auth
-- Admin API to delete auth.users alone correctly wipes everything the
-- user OWNS. This migration adds the one thing cascade structurally can't
-- reach: plain email/array columns on rows OWNED BY SOMEONE ELSE
-- (groups.member_emails, group_challenges.member_emails,
-- focus_sessions.participant_emails, reactions.recipient_email,
-- challenge_notifications.recipient_email/started_by_email).
--
-- Same dedicated-trusted-role pattern as apply_streak_freeze
-- (20260727090001): a NOLOGIN role owns exactly one SECURITY DEFINER
-- function, so `current_user` can only ever equal this role's name for
-- the duration of that one function's execution -- nothing else reachable
-- from the client API can produce it.
--
-- Verified against the LIVE database (not just migration source) before
-- writing this: protect_streak_freezes_fields is deployed as SECURITY
-- INVOKER despite its own migration file (now corrected, see
-- 20260727090001) having said SECURITY DEFINER -- a real, untracked
-- drift, evidently hand-fixed at some point after hitting exactly the
-- trap that fix corrects for. protect_reactions_fields and
-- protect_challenge_notifications_fields are still deployed as SECURITY
-- DEFINER (also verified live) -- this migration applies the same fix to
-- both, since they'd otherwise silently reject every write this new RPC
-- needs to make, including legitimate ones.
--
-- BYPASSRLS on the new role, unlike freeze_rpc_trusted: this function
-- writes to rows owned by users OTHER than the caller (freeze_rpc_trusted
-- never needed to -- apply_streak_freeze only ever touches the caller's
-- own row). An earlier draft of this migration tried extending the 5
-- affected UPDATE policies with a `current_user = 'account_deletion_
-- trusted'` OR-clause instead of BYPASSRLS, to keep the exception
-- auditable in the policy text rather than a blanket bypass. That failed
-- empirically: reactions_update_as_recipient/challenge_notifications_
-- update_as_recipient's existing clause references current_email()
-- (-> auth.jwt()), and current_email() being STABLE makes it eligible
-- for inlining into the RLS policy's query plan -- which re-checks
-- EXECUTE/schema-usage against the CALLING role, not just the function's
-- own security context. account_deletion_trusted has no USAGE on schema
-- auth, and postgres (the only role available to run this migration)
-- turned out to lack GRANT OPTION on schema auth entirely (owned by
-- supabase_admin) -- confirmed via a real transactional test attempt
-- (BEGIN; SET LOCAL ROLE account_deletion_trusted; UPDATE ...; ROLLBACK;)
-- that failed with "permission denied for schema auth ... during
-- inlining", and via pg_namespace.nspacl showing the grant silently
-- didn't take. BYPASSRLS sidesteps this: RLS policies (and their
-- current_email() references) are never evaluated for this role at all,
-- and postgres CAN grant BYPASSRLS despite not being flagged rolsuper
-- (confirmed the same way, transactionally). Column-lockdown triggers are
-- unaffected by BYPASSRLS -- confirmed by the ORIGINAL 20260727090001
-- migration's own comment: "RLS bypass (BYPASSRLS on service_role) does
-- NOT skip triggers -- triggers always fire" -- so the trigger fix below
-- is still required and still the real enforcement for those columns.
--
-- The trigger fix below also deliberately omits the `auth.role() is
-- distinct from 'service_role'` fallback the sibling lockdown triggers
-- use (protect_user_profiles_billing_fields, protect_streak_freezes_
-- fields): calling auth.role() from inside these triggers while running
-- as account_deletion_trusted hits the exact same schema-auth wall as
-- current_email() did above (confirmed the same way, transactionally --
-- "permission denied for schema auth" from inside the trigger body this
-- time, not from RLS inlining). Since sweep_deleted_user_references() is
-- only ever invoked via the caller's own JWT-authenticated client, never
-- a raw service_role connection, current_user alone is both necessary
-- and sufficient here -- there's no legitimate service_role path to this
-- trigger's exception to preserve.
--
-- Every write path in this migration was verified with a real
-- transactional test against production (BEGIN; SET LOCAL ROLE
-- account_deletion_trusted; <the actual UPDATE>; ROLLBACK;), not just
-- static catalog inspection -- has_function_privilege()/
-- has_schema_privilege() proved unreliable indicators for a NOINHERIT
-- role during this work (reported privileges this role didn't actually
-- have at runtime) and are not trusted for this migration's design.
-- Confirmed working: the reactions.recipient_email anonymization, the
-- groups.member_emails array removal, and that a non-trusted role
-- attempting the same recipient_email change is still correctly
-- rejected by the trigger.

-- ============================================================
-- Dedicated trusted role
-- ============================================================
create role account_deletion_trusted noinherit nologin bypassrls;
grant account_deletion_trusted to current_user;
-- USAGE + CREATE on schema public are both required for `ALTER FUNCTION
-- ... OWNER TO` to succeed below -- confirmed the hard way: USAGE alone
-- produced "permission denied for schema public". freeze_rpc_trusted's
-- own migration (20260727090001) only grants USAGE too, yet its live
-- grant is USAGE+CREATE (verified via pg_namespace.nspacl) -- the same
-- "hand-patched live, never captured in a migration" pattern as the
-- SECURITY DEFINER fix, found while this migration hit the exact
-- permission error the original fix must have been for.
grant usage on schema public to account_deletion_trusted;
grant create on schema public to account_deletion_trusted;
grant select, update on public.groups to account_deletion_trusted;
grant select, update on public.group_challenges to account_deletion_trusted;
grant select, update on public.focus_sessions to account_deletion_trusted;
grant select, update on public.reactions to account_deletion_trusted;
grant select, update on public.challenge_notifications to account_deletion_trusted;

-- ============================================================
-- Column-lockdown triggers: fixed to SECURITY INVOKER (see comment above)
-- with a narrow, single-column-scoped exception for account_deletion_trusted.
-- Every other locked column (sender_email, sender_name, group_id, emoji,
-- created_by_id/created_by/created_at on reactions; challenge_id,
-- group_id, group_name, habit_name, duration_days, created_by_id/
-- created_by/created_at on challenge_notifications) stays fully immutable
-- even for this role -- the exception is exactly as wide as the sweep
-- needs and no wider. Triggers themselves already exist (created in
-- 20260730090002) and dispatch by function name, so CREATE OR REPLACE
-- here is sufficient -- no need to drop/recreate the triggers.
-- ============================================================
create or replace function public.protect_reactions_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.sender_email is distinct from old.sender_email
    or new.sender_name is distinct from old.sender_name
    or new.group_id is distinct from old.group_id
    or new.emoji is distinct from old.emoji
    or new.created_by_id is distinct from old.created_by_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only read/recipient_email (via account deletion) can be changed on reactions; all other fields are immutable after creation';
  end if;

  -- No auth.role() = 'service_role' fallback here (unlike the sibling
  -- lockdown triggers this pattern is modeled on) -- account_deletion_
  -- trusted has no schema-auth USAGE grant (postgres, the only role that
  -- can run this migration, lacks GRANT OPTION on schema auth, owned by
  -- supabase_admin -- confirmed empirically), so calling auth.role() here
  -- would fail with "permission denied for schema auth" the moment this
  -- trigger fires for account_deletion_trusted, which is the ONLY path
  -- that's ever supposed to reach this branch. sweep_deleted_user_
  -- references() is only ever invoked via the caller's own JWT-
  -- authenticated client (never a raw service_role connection), so
  -- current_user alone is both necessary and sufficient here.
  if (
    new.recipient_email is distinct from old.recipient_email
  ) and current_user is distinct from 'account_deletion_trusted' then
    raise exception 'recipient_email can only be changed via account deletion';
  end if;

  return new;
end;
$$;

create or replace function public.protect_challenge_notifications_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.challenge_id is distinct from old.challenge_id
    or new.group_id is distinct from old.group_id
    or new.group_name is distinct from old.group_name
    or new.habit_name is distinct from old.habit_name
    or new.duration_days is distinct from old.duration_days
    or new.created_by_id is distinct from old.created_by_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only dismissed/recipient_email/started_by_* (via account deletion) can be changed on challenge_notifications; all other fields are immutable after creation';
  end if;

  -- Same reasoning as protect_reactions_fields: no auth.role() fallback,
  -- current_user alone is the correct and sufficient check here.
  if (
    new.recipient_email is distinct from old.recipient_email
    or new.started_by_email is distinct from old.started_by_email
    or new.started_by_name is distinct from old.started_by_name
  ) and current_user is distinct from 'account_deletion_trusted' then
    raise exception 'recipient_email/started_by_email/started_by_name can only be changed via account deletion';
  end if;

  return new;
end;
$$;

-- ============================================================
-- sweep_deleted_user_references(): removes the caller's own email from
-- every array column on rows owned by someone else, and anonymizes their
-- email on reactions/notifications owned by someone else. Rows the caller
-- owns are deliberately excluded (created_by_id <> v_caller_id) -- those
-- get cascade-deleted whole by the Admin API call that follows this in
-- the edge function, so touching them here first would be wasted work.
--
-- No parameters: derives the caller's identity entirely from auth.uid()/
-- auth.jwt(), same as every other RPC built today (join_group,
-- send_reaction) -- this is what makes it safe to grant broadly to
-- `authenticated`. A version taking a target user id/email as a parameter
-- would let any authenticated caller vandalize anyone else's data.
--
-- auth.uid()/auth.jwt() called directly here (plpgsql body, not inlined
-- SQL) work fine despite account_deletion_trusted having no schema-auth
-- usage grant -- confirmed by precedent (apply_streak_freeze, owned by
-- freeze_rpc_trusted which also has no auth-schema ACL entry, already
-- does exactly this successfully in production). The schema-auth
-- permission wall this migration hit is specific to current_email()
-- getting inlined into an RLS policy's query plan, not to plpgsql
-- function bodies calling auth.* directly -- see the BYPASSRLS comment
-- above for why that path is avoided entirely now anyway.
-- ============================================================
create or replace function public.sweep_deleted_user_references()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  update public.groups
  set member_emails = array_remove(member_emails, v_caller_email)
  where member_emails @> array[v_caller_email]
    and created_by_id <> v_caller_id;

  update public.group_challenges
  set member_emails = array_remove(member_emails, v_caller_email)
  where member_emails @> array[v_caller_email]
    and created_by_id <> v_caller_id;

  update public.focus_sessions
  set participant_emails = array_remove(participant_emails, v_caller_email)
  where participant_emails @> array[v_caller_email]
    and created_by_id <> v_caller_id;

  update public.reactions
  set recipient_email = '[deleted user]'
  where recipient_email = v_caller_email
    and created_by_id <> v_caller_id;

  update public.challenge_notifications
  set recipient_email = case when recipient_email = v_caller_email then '[deleted user]' else recipient_email end,
      started_by_email = case when started_by_email = v_caller_email then '[deleted user]' else started_by_email end,
      started_by_name = case when started_by_email = v_caller_email then '[deleted user]' else started_by_name end
  where (recipient_email = v_caller_email or started_by_email = v_caller_email)
    and created_by_id <> v_caller_id;
end;
$$;

alter function public.sweep_deleted_user_references() owner to account_deletion_trusted;

revoke all on function public.sweep_deleted_user_references() from public;
grant execute on function public.sweep_deleted_user_references() to authenticated;
