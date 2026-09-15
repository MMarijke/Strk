-- Feature: Accountability Partner. A Pro user can pair 1:1 with someone
-- (any Strk user, invited by email or picked from a shared group) for a
-- focused partner view distinct from the group-wide leaderboard: each
-- side's habit names, current streak, and today's check-in -- deliberately
-- NOT the raw completions history, so the pairing can't be used to see
-- exactly which past days a specific person missed.
--
-- Unlike Freeze Assist's assist_rpc_trusted, none of these functions need
-- a dedicated non-owner role: there is no pre-existing column-lockdown
-- trigger anywhere that must recognize a specific role name, so every
-- write here is simplest left owned by this migration's own definer
-- (the table owner), which bypasses RLS the same way send_reaction() and
-- get_challenge_member_progress() already do -- no new role, no risk of
-- the "RLS default-deny with zero matching policy" trap just fixed in
-- 20260915090003.

-- ============================================================
-- accountability_partnerships: one row per invite/pairing. Only one
-- pending-or-active row may ever involve a given user at a time (either
-- side) -- enforced both here in the RPCs and, as a fail-closed backstop,
-- by a trigger below.
-- ============================================================
create table public.accountability_partnerships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  requester_email text not null,
  partner_id uuid not null references auth.users (id) on delete cascade,
  partner_email text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'ended')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> partner_id)
);

create index accountability_partnerships_requester_idx on public.accountability_partnerships (requester_id);
create index accountability_partnerships_partner_idx on public.accountability_partnerships (partner_id);

alter table public.accountability_partnerships enable row level security;

create policy "accountability_partnerships_select" on public.accountability_partnerships for select
  using (requester_id = auth.uid() or partner_id = auth.uid());

-- No insert/update/delete policies at all: every write goes through the
-- RPCs below (default-owner, bypasses RLS). A direct client insert/update
-- is denied by default since no permissive policy exists for those
-- commands -- the same rule that bit freeze_assists moments ago, used
-- correctly here as the actual security boundary instead of by accident.

-- Fail-closed backstop for the "one partnership at a time" rule: even if
-- the RPCs' own pre-checks below raced (two concurrent requests each
-- seeing zero existing rows before either commits), this rejects the
-- second write outright rather than allowing two simultaneous partners.
create or replace function public.enforce_single_active_partnership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('pending', 'active') then
    if exists (
      select 1 from public.accountability_partnerships p
      where p.id <> new.id
        and p.status in ('pending', 'active')
        and (
          p.requester_id in (new.requester_id, new.partner_id)
          or p.partner_id in (new.requester_id, new.partner_id)
        )
    ) then
      raise exception 'One of these users already has a pending invite or an active accountability partner.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_single_active_partnership_trigger
  before insert or update on public.accountability_partnerships
  for each row execute function public.enforce_single_active_partnership();

-- ============================================================
-- accountability_nudges: one-tap, rate-limited (1/day per partnership)
-- private poke. A dedicated table rather than reusing `reactions` --
-- different rate-limit rule, different audience (1:1 only), and the
-- established pattern in this codebase is one table per notification
-- type rather than overloading an existing one.
-- ============================================================
create table public.accountability_nudges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_email text not null,
  recipient_email text not null,
  partnership_id uuid not null references public.accountability_partnerships (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index accountability_nudges_recipient_idx on public.accountability_nudges (recipient_email);
create index accountability_nudges_sender_partnership_idx on public.accountability_nudges (sender_id, partnership_id, created_at);

alter table public.accountability_nudges enable row level security;

create policy "accountability_nudges_select" on public.accountability_nudges for select
  using (sender_id = auth.uid() or recipient_email = current_email());

alter publication supabase_realtime add table public.accountability_nudges;

-- ============================================================
-- Widen user_profiles_select so an active partner can see your display
-- name / avatar / stats even if your profile is otherwise private
-- (is_public = false) -- a mutual, consented 1:1 pairing is a stronger
-- trust signal than the public leaderboard opt-in, and the partner
-- dashboard below already shows this person far more (per-habit streaks)
-- than a profile row would.
-- ============================================================
drop policy if exists "user_profiles_select" on public.user_profiles;
create policy "user_profiles_select" on public.user_profiles for select
  using (
    created_by_id = auth.uid()
    or is_public = true
    or exists (
      select 1 from public.accountability_partnerships ap
      where ap.status = 'active'
        and (
          (ap.requester_id = auth.uid() and ap.partner_id = user_profiles.created_by_id)
          or (ap.partner_id = auth.uid() and ap.requester_id = user_profiles.created_by_id)
        )
    )
  );

-- ============================================================
-- compute_current_streak: ports StreakWidget.jsx's calculateStreak() to
-- SQL -- same semantics (dedupe, walk back day-by-day from the most
-- recent completion, zero unless that most recent day is today or
-- yesterday) so the number a partner sees matches what the habit's own
-- owner sees on their own Dashboard. Regex pre-filter before casting to
-- date, same lesson as 20260915090001 -- one malformed legacy entry must
-- not be able to throw and blank a partner's whole dashboard.
-- ============================================================
create or replace function public.compute_current_streak(p_completions text[])
returns integer
language sql
stable
set search_path = public
as $$
  with valid_days as (
    select distinct d::date as day
    from unnest(coalesce(p_completions, '{}'::text[])) as d
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
-- request_accountability_partner: the invite write path. Pro-gated on the
-- CALLER only (per product decision -- a Free user can be invited and
-- accept, tasting the feature themselves). Resolves the target by email
-- via user_profiles the same trustworthy way assist_streak_freeze does.
-- ============================================================
create or replace function public.request_accountability_partner(p_partner_email text)
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

  return v_row;
end;
$$;

revoke all on function public.request_accountability_partner(text) from public;
grant execute on function public.request_accountability_partner(text) to authenticated;

-- ============================================================
-- respond_accountability_partner: only the invited partner may accept or
-- decline, and only while still pending.
-- ============================================================
create or replace function public.respond_accountability_partner(p_partnership_id uuid, p_accept boolean)
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

  update public.accountability_partnerships
  set status = case when p_accept then 'active' else 'declined' end,
      responded_at = now()
  where id = p_partnership_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.respond_accountability_partner(uuid, boolean) from public;
grant execute on function public.respond_accountability_partner(uuid, boolean) to authenticated;

-- ============================================================
-- end_accountability_partnership: either side can end an active
-- partnership; only the original requester can cancel their own
-- still-pending invite (the invited side already has decline for that).
-- ============================================================
create or replace function public.end_accountability_partnership(p_partnership_id uuid)
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
    raise exception 'Partnership not found.';
  end if;

  if v_row.requester_id <> v_caller_id and v_row.partner_id <> v_caller_id then
    raise exception 'Not part of this partnership.';
  end if;

  if v_row.status = 'pending' and v_row.requester_id <> v_caller_id then
    raise exception 'Only the sender can cancel a pending invite.';
  end if;

  if v_row.status not in ('pending', 'active') then
    raise exception 'This partnership has already ended.';
  end if;

  update public.accountability_partnerships
  set status = 'ended', responded_at = coalesce(responded_at, now())
  where id = p_partnership_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.end_accountability_partnership(uuid) from public;
grant execute on function public.end_accountability_partnership(uuid) to authenticated;

-- ============================================================
-- get_partner_dashboard: read-only. Finds the caller's active
-- partnership (if any) and returns the OTHER side's habits, narrowed to
-- exactly what was scoped for this feature -- name, current streak,
-- today's check-in. No raw completions array crosses this boundary.
-- Works for either side of the pairing, Pro or not: once a partnership is
-- active, the view is mutual (only creating one required Pro).
-- ============================================================
create or replace function public.get_partner_dashboard()
returns table(
  partnership_id uuid,
  partner_email text,
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
    v_other_id := v_partnership.partner_id;
    v_other_email := v_partnership.partner_email;
  else
    v_other_id := v_partnership.requester_id;
    v_other_email := v_partnership.requester_email;
  end if;

  return query
  select
    v_partnership.id,
    v_other_email,
    h.id,
    h.name,
    public.compute_current_streak(h.completions),
    (current_date::text = any(h.completions))
  from public.habits h
  where h.created_by_id = v_other_id
    and coalesce(h.archived, false) = false
  order by h.created_at asc;
end;
$$;

revoke all on function public.get_partner_dashboard() from public;
grant execute on function public.get_partner_dashboard() to authenticated;

-- ============================================================
-- send_accountability_nudge: one-tap, capped at once per day per
-- partnership per sender (matches send_reaction's count-before-insert
-- shape, same MVCC-visibility reasoning documented there for why this is
-- an explicit count check rather than a WITH CHECK subquery).
-- ============================================================
create or replace function public.send_accountability_nudge()
returns public.accountability_nudges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_partnership public.accountability_partnerships;
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

  v_recipient_email := case when v_partnership.requester_id = v_caller_id
    then v_partnership.partner_email else v_partnership.requester_email end;

  select count(*) into v_sent_today
  from public.accountability_nudges
  where sender_id = v_caller_id
    and partnership_id = v_partnership.id
    and created_at >= date_trunc('day', now());

  if v_sent_today >= 1 then
    raise exception 'NUDGE_LIMIT_REACHED';
  end if;

  insert into public.accountability_nudges (sender_id, sender_email, recipient_email, partnership_id)
  values (v_caller_id, v_caller_email, v_recipient_email, v_partnership.id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_accountability_nudge() from public;
grant execute on function public.send_accountability_nudge() to authenticated;
