-- Accountability Partner: opt-in habit scoping, both sides in one read,
-- and a nudge that names a habit.
--
-- These are one migration because they are one data model. Until now
-- get_partner_dashboard returned EVERY non-archived habit of the other
-- side, forever, with no disclosure at any point -- accepting an invite
-- granted a standing read of someone's whole habit list. 20260915090004
-- was careful to keep the raw completions array from crossing the
-- boundary so a pairing could not be used to audit which specific days
-- someone missed, but it never asked whether the habit list itself
-- should cross. This adds the share scope that was missing, and once a
-- scope exists the other two fall out of it: the dashboard has a defined
-- row set to show both sides of, and a nudge has a specific habit to
-- name.

-- ============================================================
-- accountability_shared_habits: which of MY habits a specific
-- partnership may see. One row per (partnership, habit).
--
-- owner_id is stored rather than reached through habits.created_by_id so
-- the RLS policy and the per-side joins below need no join to resolve
-- "mine". It is redundant with the habit's own owner by construction,
-- which the trigger at the bottom of this file enforces rather than
-- trusting.
--
-- Both foreign keys cascade:
--   * off the partnership, so ending a pairing revokes the scope with no
--     cleanup job, and re-pairing starts empty -- consent must not
--     survive the relationship it was given in;
--   * off the habit, so deleting a habit withdraws it from a partner's
--     view rather than leaving a dangling scope row.
-- auth.users already cascades to both parents, so account deletion
-- reaches these rows twice over and 20260811090006_delete_account.sql
-- needs no new email-column cleanup for this table.
-- ============================================================
create table public.accountability_shared_habits (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.accountability_partnerships (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  habit_id uuid not null references public.habits (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (partnership_id, habit_id)
);

create index accountability_shared_habits_partnership_owner_idx
  on public.accountability_shared_habits (partnership_id, owner_id);

alter table public.accountability_shared_habits enable row level security;

-- The owner sees their own scope rows, which is what the "what am I
-- sharing" UI reads. The partner deliberately does NOT read this table:
-- they learn what is shared from get_partner_dashboard's rows, which is
-- the same narrow channel 20260915090004 established for everything
-- about the other side.
create policy "accountability_shared_habits_select_own"
  on public.accountability_shared_habits for select
  using (owner_id = auth.uid());

-- No insert/update/delete policies at all, matching
-- accountability_partnerships: every write goes through the RPCs below,
-- which is this feature's actual security boundary rather than an
-- accident. A client that could insert here directly could grant itself
-- read access to habits it does not own.

-- GDPR/POPIA (CLAUDE.md): these rows record that one user let another
-- see a named habit, so they are personal data for both parties.
-- Deletion is covered by the cascades above. RETENTION: a scope row
-- lives exactly as long as the partnership that contains it -- there is
-- no archival copy and nothing here outlives the relationship.

-- ============================================================
-- Backfill: preserve what existing partners can already see.
--
-- Narrowing get_partner_dashboard to this table would otherwise blank
-- every live partnership until each side happened to open the app and
-- pick -- which looks exactly like the silent-empty-state bug
-- 20261022090001's PR had to go and fix, and would read as a partner
-- having abandoned every habit they had.
--
-- Inserting what is ALREADY VISIBLE creates no new exposure: these are
-- precisely the habits the old unscoped function was handing over
-- anyway. It preserves the status quo rather than manufacturing consent
-- for anything new, and the client surfaces a one-time "you are sharing
-- these -- choose what to share" notice so the choice is collected
-- visibly after the fact instead of never.
--
-- Only 'active' partnerships. A pending invite predates this migration's
-- notion of an offer and has no scope to preserve; those requesters pick
-- when they next invite.
-- ============================================================
insert into public.accountability_shared_habits (partnership_id, owner_id, habit_id)
select p.id, h.created_by_id, h.id
from public.accountability_partnerships p
join public.habits h
  on h.created_by_id in (p.requester_id, p.partner_id)
 and coalesce(h.archived, false) = false
where p.status = 'active'
on conflict (partnership_id, habit_id) do nothing;

-- ============================================================
-- habit_frozen_dates: every date this habit has ever been frozen on.
--
-- streak_freezes stores frozen_habits as { habitId: "YYYY-MM-DD" } on a
-- per-month row (month_key -- renamed from week_key by 20260723090001),
-- so one habit can hold at most one frozen date per month but several
-- across months, and a freeze from three months ago still sits inside a
-- current streak. Aggregating across all of the owner's rows is
-- therefore the only correct reading; looking at the current month would
-- silently break any streak spanning an older freeze.
--
-- Internal: execute is revoked below, so no client can reach it. It is
-- also left SECURITY INVOKER rather than DEFINER, as a second line --
-- a DEFINER function taking an arbitrary p_owner_id would be a
-- read-anyone's-freeze-history hole the moment anything granted it, and
-- as INVOKER even a mistaken grant leaves streak_freezes' owner-only
-- policy (20260915090003) confining the caller to their own rows. The
-- SECURITY DEFINER functions below call it as the table owner, which
-- bypasses RLS the way this feature's reads already do, so they still
-- see both sides' freezes.
-- ============================================================
create or replace function public.habit_frozen_dates(p_owner_id uuid, p_habit_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(sf.frozen_habits ->> p_habit_id::text), '{}'::text[])
  from public.streak_freezes sf
  where sf.created_by_id = p_owner_id
    and sf.frozen_habits ? p_habit_id::text;
$$;

revoke all on function public.habit_frozen_dates(uuid, uuid) from public;

-- ============================================================
-- compute_current_streak: now freeze-aware.
--
-- The client's calculateStreak(completions, frozenDate) treats a frozen
-- day as a completion; this function had no such parameter, so it
-- counted the frozen day as a miss and broke the streak there. Until now
-- only the PARTNER's number was ever rendered from it, so nobody could
-- see the two definitions disagree. Showing both sides makes it visible
-- to the one person who can tell it is wrong: you would read 3 against
-- your own habit here while your Dashboard says 12. That is the same
-- class of bug as DashboardSummary calling calculateStreak without each
-- habit's frozen date and reporting 18 where the card said 23.
--
-- Replaced rather than overloaded: adding a defaulted second parameter
-- would leave both signatures resolvable from PostgREST, and a call
-- naming only p_completions would match both and fail ambiguously --
-- which is why every signature change in this file drops first.
-- ============================================================
drop function if exists public.compute_current_streak(text[]);

create or replace function public.compute_current_streak(p_completions text[], p_frozen_dates text[])
returns integer
language sql
stable
set search_path = public
as $$
  with valid_days as (
    -- Frozen dates join the completions before the run is walked, which
    -- is exactly what the client does by pushing frozenDate into
    -- `effective`. Both arrays get the same regex pre-filter before the
    -- date cast -- same lesson as 20260915090001: one malformed legacy
    -- entry must not throw and blank a partner's whole dashboard.
    select distinct d::date as day
    from unnest(
      coalesce(p_completions, '{}'::text[]) || coalesce(p_frozen_dates, '{}'::text[])
    ) as d
    where d ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  runs as (
    select day, day - (row_number() over (order by day))::integer * interval '1 day' as grp
    from valid_days
  ),
  run_lengths as (
    select max(day) as run_end, count(*) as run_length
    from runs
    group by grp
  ),
  most_recent as (
    select max(day) as last_day from valid_days
  )
  select coalesce(
    (select rl.run_length
     from run_lengths rl, most_recent mr
     where rl.run_end = mr.last_day
       and mr.last_day >= current_date - 1),
    0
  );
$$;

-- ============================================================
-- assert_owns_habits: shared validation for the three write paths that
-- accept a habit id array.
--
-- An empty array is valid everywhere -- pairing without sharing has to
-- remain possible, or the consent screen is a demand rather than a
-- choice. Archived habits are rejected: sharing one would put a row in
-- the partner's view that the dashboard then filters out, so the owner
-- would believe they shared something invisible.
-- ============================================================
create or replace function public.assert_owns_habits(p_owner_id uuid, p_habit_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_habit_ids is null or cardinality(p_habit_ids) = 0 then
    return;
  end if;

  if exists (
    select 1 from unnest(p_habit_ids) as hid
    where not exists (
      select 1 from public.habits h
      where h.id = hid
        and h.created_by_id = p_owner_id
        and coalesce(h.archived, false) = false
    )
  ) then
    raise exception 'You can only share your own active habits.';
  end if;
end;
$$;

revoke all on function public.assert_owns_habits(uuid, uuid[]) from public;

-- ============================================================
-- request_accountability_partner: now carries what the requester offers.
--
-- The offer is made at invite time, not after acceptance, because the
-- consent screen has to have something to disclose -- otherwise the
-- invited side is deciding blind again and the disclosure has only moved
-- one screen later.
-- ============================================================
drop function if exists public.request_accountability_partner(text);

create or replace function public.request_accountability_partner(p_partner_email text, p_habit_ids uuid[])
returns public.accountability_partnerships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_caller_is_pro boolean;
  v_partner_id uuid;
  v_conflict_count integer;
  v_row public.accountability_partnerships;
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  if p_partner_email = v_caller_email then
    raise exception 'You cannot pair with yourself.';
  end if;

  perform public.assert_owns_habits(v_caller_id, p_habit_ids);

  select (plan = 'pro') into v_caller_is_pro
  from public.user_profiles
  where created_by_id = v_caller_id;

  if not coalesce(v_caller_is_pro, false) then
    raise exception 'Accountability Partner is a Pro feature.';
  end if;

  select created_by_id into v_partner_id
  from public.user_profiles
  where created_by = p_partner_email;

  if v_partner_id is null then
    raise exception 'Could not find a Strk user with that email.';
  end if;

  select count(*) into v_conflict_count
  from public.accountability_partnerships
  where status in ('pending', 'active')
    and (requester_id = v_caller_id or partner_id = v_caller_id);

  if v_conflict_count > 0 then
    raise exception 'You already have a pending invite or an active partner. End it before starting a new one.';
  end if;

  select count(*) into v_conflict_count
  from public.accountability_partnerships
  where status in ('pending', 'active')
    and (requester_id = v_partner_id or partner_id = v_partner_id);

  if v_conflict_count > 0 then
    raise exception 'That person already has a pending invite or an active partner.';
  end if;

  insert into public.accountability_partnerships (requester_id, requester_email, partner_id, partner_email, status)
  values (v_caller_id, v_caller_email, v_partner_id, p_partner_email, 'pending')
  returning * into v_row;

  insert into public.accountability_shared_habits (partnership_id, owner_id, habit_id)
  select distinct v_row.id, v_caller_id, hid
  from unnest(coalesce(p_habit_ids, '{}'::uuid[])) as hid;

  return v_row;
end;
$$;

revoke all on function public.request_accountability_partner(text, uuid[]) from public;
grant execute on function public.request_accountability_partner(text, uuid[]) to authenticated;

-- ============================================================
-- respond_accountability_partner: accepting is now also choosing.
--
-- p_habit_ids is ignored on a decline -- there is nothing to share with
-- a partnership that will never be active, and writing scope rows for
-- one would leave them behind the declined row forever.
-- ============================================================
drop function if exists public.respond_accountability_partner(uuid, boolean);

create or replace function public.respond_accountability_partner(p_partnership_id uuid, p_accept boolean, p_habit_ids uuid[])
returns public.accountability_partnerships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_row public.accountability_partnerships;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.accountability_partnerships where id = p_partnership_id;

  if v_row is null then
    raise exception 'Invite not found.';
  end if;

  if v_row.partner_id <> v_caller_id then
    raise exception 'Only the invited partner can respond to this invite.';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'This invite has already been responded to.';
  end if;

  if p_accept then
    perform public.assert_owns_habits(v_caller_id, p_habit_ids);
  end if;

  update public.accountability_partnerships
  set status = case when p_accept then 'active' else 'declined' end,
      responded_at = now()
  where id = p_partnership_id
  returning * into v_row;

  if p_accept then
    insert into public.accountability_shared_habits (partnership_id, owner_id, habit_id)
    select distinct p_partnership_id, v_caller_id, hid
    from unnest(coalesce(p_habit_ids, '{}'::uuid[])) as hid
    on conflict (partnership_id, habit_id) do nothing;
  end if;

  return v_row;
end;
$$;

revoke all on function public.respond_accountability_partner(uuid, boolean, uuid[]) from public;
grant execute on function public.respond_accountability_partner(uuid, boolean, uuid[]) to authenticated;

-- ============================================================
-- set_shared_habits: change what you share, afterwards.
--
-- Consent that cannot be withdrawn is not consent, so this is the same
-- operation in both directions -- a full replacement of the caller's own
-- scope rather than add/remove calls, which keeps the client's job "send
-- the current selection" and makes a lost request leave no half-state.
--
-- Deleting only the caller's rows is the whole safety property here: a
-- partnership holds both sides' scope in one table and nobody may
-- revoke, or extend, what the other side chose to share.
-- ============================================================
create or replace function public.set_shared_habits(p_habit_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_partnership public.accountability_partnerships;
  v_count integer;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_owns_habits(v_caller_id, p_habit_ids);

  -- Pending as well as active: a requester who has not been accepted yet
  -- can still change their mind about the offer on the table.
  select * into v_partnership
  from public.accountability_partnerships
  where status in ('pending', 'active')
    and (requester_id = v_caller_id or partner_id = v_caller_id)
  limit 1;

  if v_partnership is null then
    raise exception 'You do not have an accountability partner.';
  end if;

  delete from public.accountability_shared_habits
  where partnership_id = v_partnership.id
    and owner_id = v_caller_id;

  insert into public.accountability_shared_habits (partnership_id, owner_id, habit_id)
  select distinct v_partnership.id, v_caller_id, hid
  from unnest(coalesce(p_habit_ids, '{}'::uuid[])) as hid;

  select count(*) into v_count
  from public.accountability_shared_habits
  where partnership_id = v_partnership.id and owner_id = v_caller_id;

  return v_count;
end;
$$;

revoke all on function public.set_shared_habits(uuid[]) from public;
grant execute on function public.set_shared_habits(uuid[]) to authenticated;

-- ============================================================
-- get_partner_invite_preview: what the consent screen discloses.
--
-- The invited side needs the requester's identity and the habit names
-- they are offering BEFORE deciding -- and get_partner_dashboard
-- requires an active partnership, which is precisely the thing being
-- decided. Hence a second, narrower read.
--
-- Names only. No streaks, no completion state, nothing about how the
-- requester is actually doing: none of that is needed to decide whether
-- to pair, and a pending invite is a weaker relationship than an
-- accepted one, so it gets strictly less.
--
-- Readable only by the invited partner of a still-pending row, so it
-- cannot be used to inspect invites addressed to anybody else.
-- ============================================================
create or replace function public.get_partner_invite_preview()
returns table(
  partnership_id uuid,
  requester_email text,
  requester_name text,
  requester_avatar_color text,
  habit_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_partnership public.accountability_partnerships;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_partnership
  from public.accountability_partnerships
  where status = 'pending'
    and partner_id = v_caller_id
  limit 1;

  if v_partnership is null then
    return;
  end if;

  -- Left join so a requester who offers nothing still returns one row
  -- carrying their identity -- the same reason 20260915090004 left-joined
  -- habits: without it the client cannot even learn who is asking.
  return query
  select
    v_partnership.id,
    v_partnership.requester_email,
    coalesce(up.display_name, split_part(v_partnership.requester_email, '@', 1)),
    up.avatar_color,
    h.name
  from public.user_profiles up
  left join public.accountability_shared_habits sh
    on sh.partnership_id = v_partnership.id and sh.owner_id = v_partnership.requester_id
  left join public.habits h
    on h.id = sh.habit_id and coalesce(h.archived, false) = false
  where up.created_by_id = v_partnership.requester_id
  order by h.created_at asc nulls last;
end;
$$;

revoke all on function public.get_partner_invite_preview() from public;
grant execute on function public.get_partner_invite_preview() to authenticated;

-- ============================================================
-- get_partner_dashboard: both sides, scoped.
--
-- Two changes. It now returns the caller's own shared habits alongside
-- their partner's, distinguished by `side`, so the two columns are built
-- from one read and one streak definition -- computing the caller's
-- column in JS and the partner's in SQL would have put two different
-- definitions of "streak" in the same table, which is how the frozen-day
-- discrepancy above becomes visible in the first place.
--
-- And both sides are narrowed to accountability_shared_habits, which is
-- the point of the migration: an active partnership no longer implies a
-- standing read of anybody's whole habit list.
--
-- Returns zero rows when there is no active partnership, unchanged --
-- the client treats zero rows as proof the partnership ended, which is
-- sound precisely because an active one always yields at least the two
-- identity rows below.
-- ============================================================
drop function if exists public.get_partner_dashboard();

create or replace function public.get_partner_dashboard()
returns table(
  partnership_id uuid,
  side text,
  user_email text,
  display_name text,
  avatar_color text,
  habit_id uuid,
  habit_name text,
  current_streak integer,
  completed_today boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text;
  v_partnership public.accountability_partnerships;
  v_other_id uuid;
  v_other_email text;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_partnership
  from public.accountability_partnerships
  where status = 'active'
    and (requester_id = v_caller_id or partner_id = v_caller_id)
  limit 1;

  if v_partnership is null then
    return;
  end if;

  if v_partnership.requester_id = v_caller_id then
    v_caller_email := v_partnership.requester_email;
    v_other_id := v_partnership.partner_id;
    v_other_email := v_partnership.partner_email;
  else
    v_caller_email := v_partnership.partner_email;
    v_other_id := v_partnership.requester_id;
    v_other_email := v_partnership.requester_email;
  end if;

  -- display_name/avatar_color stay the ONLY user_profiles columns that
  -- cross this boundary, for the reason 20260915090004 spells out: that
  -- table also carries paddle_* ids, subscription_status and live Paddle
  -- self-service URLs, so this narrow projection is the deliberate
  -- replacement for ever widening user_profiles_select.
  return query
  with sides as (
    select v_caller_id as uid, v_caller_email as email, 'you'::text as side
    union all
    select v_other_id, v_other_email, 'partner'::text
  ),
  -- Resolved before the left join rather than inside it: joining the
  -- scope table and filtering archived habits in the same left join
  -- would emit a null-habit row for every shared-but-archived habit,
  -- each indistinguishable from the "shares nothing" identity row. This
  -- way a side with no visible shared habits produces exactly one.
  shared as (
    select sh.owner_id, h.id, h.name, h.completions, h.created_at
    from public.accountability_shared_habits sh
    join public.habits h
      on h.id = sh.habit_id and coalesce(h.archived, false) = false
    where sh.partnership_id = v_partnership.id
  )
  select
    v_partnership.id,
    s.side,
    s.email,
    coalesce(up.display_name, split_part(s.email, '@', 1)),
    up.avatar_color,
    sh.id,
    sh.name,
    public.compute_current_streak(sh.completions, public.habit_frozen_dates(s.uid, sh.id)),
    coalesce(current_date::text = any(sh.completions), false)
  from sides s
  join public.user_profiles up on up.created_by_id = s.uid
  left join shared sh on sh.owner_id = s.uid
  -- Explicit, not `order by side desc`: relying on 'you' sorting after
  -- 'partner' would be an accident of the alphabet.
  order by case when s.side = 'you' then 0 else 1 end, sh.created_at asc nulls last;
end;
$$;

revoke all on function public.get_partner_dashboard() from public;
grant execute on function public.get_partner_dashboard() to authenticated;

-- ============================================================
-- The nudge names a habit.
--
-- on delete SET NULL, not cascade: with cascade, the recipient deleting
-- a habit would delete the nudge row too and hand the sender a fresh
-- daily allowance, so the rate limit would be resettable by the person
-- it protects. Null means the nudge still happened and still counts; the
-- client falls back to its generic copy.
-- ============================================================
alter table public.accountability_nudges
  add column if not exists habit_id uuid references public.habits (id) on delete set null;

-- Immutable like every other field on this table but `read`. Named
-- explicitly because a field this guard does not mention stays silently
-- writable -- the trap 20261021090002 had to reopen for
-- reactions.focus_session_id, and the recipient has had a table-scoped
-- UPDATE policy since 20261022090001.
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
    or new.habit_id is distinct from old.habit_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only read can be changed on accountability_nudges; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

-- ============================================================
-- send_accountability_nudge: about one habit.
--
-- The cap stays ONE PER DAY PER PARTNERSHIP, not per habit. Per-habit
-- would scale the cap with how much the recipient shares, making the
-- more open partner the bigger target -- punishing exactly the behaviour
-- this feature exists to encourage. Keeping it at one makes the habit
-- choice "where do I spend today's nudge", which is a stronger mechanic
-- than an unlimited poke anyway.
--
-- p_habit_id must be in the OTHER side's scope for this partnership.
-- Without that check the parameter is an oracle for whether a habit id
-- exists, and would let a sender nudge about something deliberately not
-- shared with them -- which would disclose that they can see it.
-- ============================================================
drop function if exists public.send_accountability_nudge();

create or replace function public.send_accountability_nudge(p_habit_id uuid)
returns public.accountability_nudges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_partnership public.accountability_partnerships;
  v_recipient_id uuid;
  v_recipient_email text;
  v_sent_today integer;
  v_row public.accountability_nudges;
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_partnership
  from public.accountability_partnerships
  where status = 'active'
    and (requester_id = v_caller_id or partner_id = v_caller_id)
  limit 1;

  if v_partnership is null then
    raise exception 'You do not have an active accountability partner.';
  end if;

  if v_partnership.requester_id = v_caller_id then
    v_recipient_id := v_partnership.partner_id;
    v_recipient_email := v_partnership.partner_email;
  else
    v_recipient_id := v_partnership.requester_id;
    v_recipient_email := v_partnership.requester_email;
  end if;

  if p_habit_id is not null and not exists (
    select 1 from public.accountability_shared_habits sh
    where sh.partnership_id = v_partnership.id
      and sh.owner_id = v_recipient_id
      and sh.habit_id = p_habit_id
  ) then
    raise exception 'That habit is not shared with you.';
  end if;

  -- Counted before the insert for the MVCC-visibility reason
  -- send_reaction documents: a WITH CHECK subquery cannot see a
  -- concurrent uncommitted row either, so an explicit count is no weaker
  -- and is far easier to read.
  select count(*) into v_sent_today
  from public.accountability_nudges
  where sender_id = v_caller_id
    and partnership_id = v_partnership.id
    and created_at >= date_trunc('day', now());

  if v_sent_today >= 1 then
    raise exception 'NUDGE_LIMIT_REACHED';
  end if;

  insert into public.accountability_nudges (sender_id, sender_email, recipient_email, partnership_id, habit_id)
  values (v_caller_id, v_caller_email, v_recipient_email, v_partnership.id, p_habit_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_accountability_nudge(uuid) from public;
grant execute on function public.send_accountability_nudge(uuid) to authenticated;

-- ============================================================
-- Keep owner_id honest.
--
-- owner_id is denormalised from the habit for the sake of the RLS policy
-- and the per-side joins, and the RPCs above all set it from auth.uid().
-- This enforces what they promise rather than trusting them: a future
-- write path that passed someone else's habit with its own owner_id
-- would otherwise silently publish that habit to a partnership.
--
-- Also confines the scope row to the partnership's two participants, so
-- it cannot name a third party's partnership.
--
-- SECURITY INVOKER: it only reads two tables to validate the new row and
-- needs no elevated rights. Per CLAUDE.md a SECURITY DEFINER trigger
-- function resets current_user to its own owner, so the default here is
-- INVOKER on principle -- a guard should not take the owner's privileges
-- for free.
-- ============================================================
create or replace function public.protect_shared_habit_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.habits h
    where h.id = new.habit_id and h.created_by_id = new.owner_id
  ) then
    raise exception 'A shared-habit row must be owned by the habit''s owner';
  end if;

  if not exists (
    select 1 from public.accountability_partnerships p
    where p.id = new.partnership_id
      and new.owner_id in (p.requester_id, p.partner_id)
  ) then
    raise exception 'A shared-habit row must belong to one of the partnership''s own participants';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_shared_habit_scope_trigger on public.accountability_shared_habits;
create trigger protect_shared_habit_scope_trigger
  before insert or update on public.accountability_shared_habits
  for each row execute function public.protect_shared_habit_scope();
