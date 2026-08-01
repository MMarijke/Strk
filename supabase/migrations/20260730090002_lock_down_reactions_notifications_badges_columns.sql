-- Security follow-up: reactions/challenge_notifications UPDATE policies
-- were row-only (using (recipient_email = current_email())), with no
-- column restriction — a recipient marking read/dismissed could, in the
-- same call, also rewrite sender_email, group_id, emoji, habit_name,
-- started_by_email, etc. RLS with check clauses cannot express "column X
-- must not change" (USING sees only the old row, WITH CHECK sees only
-- the new row — neither has both versions in scope), so genuine
-- column-level lockdown requires a BEFORE UPDATE trigger, same pattern
-- as the user_profiles/streak_freezes/profiles fixes. The with check
-- clauses added here are additive (making the ownership condition
-- explicit rather than implicit) — the triggers are what actually
-- protect the other columns.
--
-- user_badges has no legitimate update path at all (confirmed:
-- UserBadge.update() is never called anywhere in the app, only
-- .create()) — so its UPDATE policy is removed entirely rather than
-- given a with check.
--
-- Both trigger functions are SECURITY DEFINER but never check
-- current_user (only OLD/NEW column values and current_email()), so the
-- SECURITY DEFINER/INVOKER trap from the freeze_rpc_trusted work does
-- not apply here.

-- ============================================================
-- reactions: only `read` is ever legitimately toggled
-- ============================================================
create or replace function public.protect_reactions_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.sender_email is distinct from old.sender_email
    or new.sender_name is distinct from old.sender_name
    or new.recipient_email is distinct from old.recipient_email
    or new.group_id is distinct from old.group_id
    or new.emoji is distinct from old.emoji
    or new.created_by_id is distinct from old.created_by_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only read can be changed on reactions; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

create trigger protect_reactions_fields_trigger
  before update on public.reactions
  for each row execute function public.protect_reactions_fields();

drop policy if exists "reactions_update_as_recipient" on public.reactions;
create policy "reactions_update_as_recipient" on public.reactions for update
  using (recipient_email = current_email())
  with check (recipient_email = current_email());

-- ============================================================
-- challenge_notifications: only `dismissed` is ever legitimately toggled
-- ============================================================
create or replace function public.protect_challenge_notifications_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.challenge_id is distinct from old.challenge_id
    or new.group_id is distinct from old.group_id
    or new.group_name is distinct from old.group_name
    or new.habit_name is distinct from old.habit_name
    or new.duration_days is distinct from old.duration_days
    or new.started_by_email is distinct from old.started_by_email
    or new.started_by_name is distinct from old.started_by_name
    or new.recipient_email is distinct from old.recipient_email
    or new.created_by_id is distinct from old.created_by_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only dismissed can be changed on challenge_notifications; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

create trigger protect_challenge_notifications_fields_trigger
  before update on public.challenge_notifications
  for each row execute function public.protect_challenge_notifications_fields();

drop policy if exists "challenge_notifications_update_as_recipient" on public.challenge_notifications;
create policy "challenge_notifications_update_as_recipient" on public.challenge_notifications for update
  using (recipient_email = current_email())
  with check (recipient_email = current_email());

-- ============================================================
-- user_badges: no legitimate update path exists anywhere in the app
-- ============================================================
drop policy if exists "user_badges_update_own" on public.user_badges;
