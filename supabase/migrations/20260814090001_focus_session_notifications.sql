-- Focus-session group notifications: when a host starts a focus session
-- linked to a group (StartFocusModal's optional group picker), every other
-- group member gets an immediate, one-tap-joinable notification -- the same
-- pattern challenge_notifications already established for challenge starts.
--
-- A dedicated table, not a shared/generic notifications table, even though
-- this is the second notification type in the app: challenge_notifications
-- has no time-sensitivity (View Challenge is valid whenever tapped), but a
-- focus session has a hard 2-minute lobby, so its "Join" action has to
-- consult live server state via join_focus_session (see
-- 20260807090001_focus_session_lobby.sql) rather than anything stored on
-- the notification row. That RPC takes p_session_code, and a recipient
-- can't SELECT focus_sessions directly (focus_sessions_select requires
-- already being a participant), so session_code has to be denormalized
-- onto this row just to make the join action possible at all -- a generic
-- payload-jsonb table would need identical per-type reasoning and would
-- also lose the hard, cascading FKs challenge_notifications relies on for
-- automatic cleanup. Two dedicated tables (mirroring reactions vs.
-- challenge_notifications already being separate) stays the established
-- shape rather than inventing a third pattern.
create table public.focus_session_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null references public.focus_sessions (id) on delete cascade,
  session_code text not null,
  group_id uuid not null references public.groups (id) on delete cascade,
  group_name text,
  host_email text not null,
  host_name text,
  duration_minutes integer not null,
  -- Denormalized copy of the session's lobby_ends_at at insert time --
  -- display-only (toast/banner copy: "join before it starts" vs. "may
  -- already be underway"). Never used to gate the actual join; the
  -- join_focus_session RPC re-derives real status server-side regardless
  -- of this column or client clock skew.
  lobby_ends_at timestamptz,
  recipient_email text not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create index focus_session_notifications_recipient_email_idx on public.focus_session_notifications (recipient_email);

alter table public.focus_session_notifications enable row level security;
create policy "focus_session_notifications_select" on public.focus_session_notifications for select
  using (created_by_id = auth.uid() or recipient_email = current_email());
create policy "focus_session_notifications_insert_own" on public.focus_session_notifications for insert
  with check (created_by_id = auth.uid());
create policy "focus_session_notifications_update_as_recipient" on public.focus_session_notifications for update
  using (recipient_email = current_email())
  with check (recipient_email = current_email());
create policy "focus_session_notifications_delete_own" on public.focus_session_notifications for delete
  using (created_by_id = auth.uid());

-- Column lockdown, same shape and same reasoning as
-- protect_challenge_notifications_fields() in
-- 20260730090002_lock_down_reactions_notifications_badges_columns.sql:
-- only `dismissed` is ever legitimately toggled by the recipient. SECURITY
-- DEFINER is safe here (not the SECURITY DEFINER/INVOKER trap) because
-- this trigger never checks current_user, only OLD/NEW column values.
create or replace function public.protect_focus_session_notifications_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.session_id is distinct from old.session_id
    or new.session_code is distinct from old.session_code
    or new.group_id is distinct from old.group_id
    or new.group_name is distinct from old.group_name
    or new.host_email is distinct from old.host_email
    or new.host_name is distinct from old.host_name
    or new.duration_minutes is distinct from old.duration_minutes
    or new.lobby_ends_at is distinct from old.lobby_ends_at
    or new.recipient_email is distinct from old.recipient_email
    or new.created_by_id is distinct from old.created_by_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only dismissed can be changed on focus_session_notifications; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

create trigger protect_focus_session_notifications_fields_trigger
  before update on public.focus_session_notifications
  for each row execute function public.protect_focus_session_notifications_fields();

alter publication supabase_realtime add table public.focus_session_notifications;
