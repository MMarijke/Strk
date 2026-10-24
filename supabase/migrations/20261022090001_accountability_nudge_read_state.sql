-- Make a nudge survive not being looked at.
--
-- accountability_nudges is in the realtime publication (20260915090004) and
-- that is the only way a nudge has ever reached anyone:
-- AccountabilityNudge.subscribe() was called in exactly one place, inside
-- the Social page component, so a nudge was delivered if and only if the
-- recipient happened to be on /Social at that second. On Dashboard,
-- Trends, Settings, backgrounded, or offline, it was destroyed -- while the
-- sender saw "Nudge sent!" and was then rate-limited out of trying again
-- for 24 hours.
--
-- Every other cross-page signal in this app is both globally mounted and
-- durable: challenge_notifications, focus_session_notifications and
-- freeze_assist_notifications are all tables with a dismissed/read flag,
-- and FocusInviteListener is mounted from AppLayout precisely so a focus
-- invite reaches whoever is on whatever page. The nudge was the only one of
-- the four with a realtime channel and no row state behind it.
--
-- The row already persisted -- what was missing was any way to tell a
-- delivered nudge from an undelivered one, so the client could not show the
-- ones it had missed without showing every nudge ever sent. That is what
-- this column is for.

-- `read`, not `dismissed`: this mirrors reactions.read, which is the closer
-- precedent -- a nudge is an acknowledgement-free signal like a reaction,
-- not a decision to resolve like a challenge or focus invite, both of which
-- use `dismissed` because the user acts on them.
alter table public.accountability_nudges
  add column if not exists read boolean not null default false;

-- Existing rows are marked read rather than left false. Without this, every
-- nudge ever sent would arrive at once the first time each recipient opened
-- the app after deploy -- a burst of weeks-old pokes, which is worse than
-- the bug being fixed. Only nudges sent from here on surface.
update public.accountability_nudges set read = true where read = false;

-- The listener's query is "my unread nudges", so the index matches it.
create index if not exists accountability_nudges_recipient_unread_idx
  on public.accountability_nudges (recipient_email, read);

-- ============================================================
-- Let the recipient mark their own nudges read.
--
-- There was no UPDATE policy at all, so with RLS enabled every update was
-- denied by default -- the client could not have marked anything read even
-- if the column had existed. Same shape as
-- reactions_update_as_recipient (20260730090002): the recipient only, and
-- `with check` as well as `using` so a row cannot be updated *into*
-- somebody else's name.
create policy "accountability_nudges_update_as_recipient"
  on public.accountability_nudges for update
  using (recipient_email = current_email())
  with check (recipient_email = current_email());

-- ============================================================
-- And let them change nothing else.
--
-- Same reasoning as protect_reactions_fields: an UPDATE policy scoped to a
-- table, not a column, would let the recipient rewrite who sent a nudge,
-- when, or which partnership it belonged to. Every field but `read` is
-- immutable after insert, compared explicitly -- a field this function does
-- not name stays silently writable, which is the trap 20261021090002 had to
-- go back and close for reactions.focus_session_id.
--
-- SECURITY INVOKER: this only compares OLD and NEW and needs no elevated
-- privilege. Per CLAUDE.md, a SECURITY DEFINER trigger function resets
-- current_user to its own owner, so anything that ever needs to know who is
-- really calling must stay INVOKER -- and a guard that never needs it
-- should not acquire the owner's rights for free either.
create or replace function public.protect_accountability_nudge_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.sender_id is distinct from old.sender_id
    or new.sender_email is distinct from old.sender_email
    or new.recipient_email is distinct from old.recipient_email
    or new.partnership_id is distinct from old.partnership_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only read can be changed on accountability_nudges; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_accountability_nudge_fields_trigger on public.accountability_nudges;
create trigger protect_accountability_nudge_fields_trigger
  before update on public.accountability_nudges
  for each row execute function public.protect_accountability_nudge_fields();
