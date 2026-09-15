-- Feature: Freeze Assist. A Pro user can spend one of their own (unlimited)
-- freezes to save a GROUPMATE's about-to-break streak, not just their own --
-- the centerpiece Pro-exclusive mechanic for this round, extending the
-- existing self-serve freeze system rather than replacing it.
--
-- apply_streak_freeze() (20260727090001) never had to check habit ownership
-- at all: it only ever operates on the CALLER's own streak_freezes row and
-- treats p_habit_id as an opaque jsonb key nobody else ever reads, so a
-- caller passing someone else's habit id today just wastes their own
-- freeze credit against data nobody looks at -- harmless, but structurally
-- incapable of writing to someone ELSE's frozen_habits map, which is what
-- an actual cross-user assist requires. This migration adds that
-- capability deliberately, with its own, narrower trust boundary.

-- ============================================================
-- freeze_assists: audit trail + idempotency guard (can't assist the same
-- target/habit/date twice, whether by the same or a different assister).
-- No client insert policy -- written only by assist_streak_freeze().
-- ============================================================
create table public.freeze_assists (
  id uuid primary key default gen_random_uuid(),
  assister_id uuid not null references auth.users (id) on delete cascade,
  assister_email text not null,
  target_id uuid not null references auth.users (id) on delete cascade,
  target_email text not null,
  habit_id uuid not null references public.habits (id) on delete cascade,
  missed_date date not null,
  created_at timestamptz not null default now()
);

create unique index freeze_assists_target_habit_date_key
  on public.freeze_assists (target_id, habit_id, missed_date);

alter table public.freeze_assists enable row level security;

create policy "freeze_assists_select" on public.freeze_assists for select
  using (assister_id = auth.uid() or target_id = auth.uid());

-- ============================================================
-- freeze_assist_notifications: same shape/lockdown pattern as
-- challenge_notifications (20260702120002 / 20260730090002) -- one
-- dedicated table per notification type, immutable except `dismissed`.
-- ============================================================
create table public.freeze_assist_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  assister_email text not null,
  assister_name text,
  recipient_email text not null,
  habit_name text not null,
  missed_date date not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create index freeze_assist_notifications_recipient_idx
  on public.freeze_assist_notifications (recipient_email);

alter table public.freeze_assist_notifications enable row level security;

create policy "freeze_assist_notifications_select" on public.freeze_assist_notifications for select
  using (created_by_id = auth.uid() or recipient_email = current_email());

create policy "freeze_assist_notifications_update_as_recipient" on public.freeze_assist_notifications for update
  using (recipient_email = current_email())
  with check (recipient_email = current_email());

-- No insert policy -- only assist_streak_freeze() (SECURITY DEFINER,
-- bypasses RLS via ownership) writes rows here, mirroring how
-- challenge_notifications' insert is a plain policy but this one has
-- nothing analogous to "the admin who started it" to safely self-attest;
-- the assister's own identity must come from auth.jwt(), not the client.

create or replace function public.protect_freeze_assist_notifications_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.assister_email is distinct from old.assister_email
    or new.assister_name is distinct from old.assister_name
    or new.recipient_email is distinct from old.recipient_email
    or new.habit_name is distinct from old.habit_name
    or new.missed_date is distinct from old.missed_date
    or new.created_by_id is distinct from old.created_by_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only dismissed can be changed on freeze_assist_notifications; all other fields are immutable after creation';
  end if;
  return new;
end;
$$;

create trigger protect_freeze_assist_notifications_fields_trigger
  before update on public.freeze_assist_notifications
  for each row execute function public.protect_freeze_assist_notifications_fields();

alter publication supabase_realtime add table public.freeze_assist_notifications;

-- ============================================================
-- Widen streak_freezes/habits RLS so freeze_rpc_trusted (the existing
-- dedicated NOLOGIN role that owns apply_streak_freeze) can act on the
-- TARGET's rows, not just the caller's own -- necessary for a genuine
-- cross-user write, which self-serve freezing never needed. This role is
-- narrow and only ever owns vetted SECURITY DEFINER functions, so
-- extending its trust here is scoped, not a general RLS loosening.
-- ============================================================
drop policy if exists "streak_freezes_select_own" on public.streak_freezes;
create policy "streak_freezes_select_own" on public.streak_freezes for select
  using (created_by_id = auth.uid() or current_user = 'freeze_rpc_trusted');

drop policy if exists "streak_freezes_insert_own" on public.streak_freezes;
create policy "streak_freezes_insert_own" on public.streak_freezes for insert
  with check (created_by_id = auth.uid() or current_user = 'freeze_rpc_trusted');

drop policy if exists "streak_freezes_update_own" on public.streak_freezes;
create policy "streak_freezes_update_own" on public.streak_freezes for update
  using (created_by_id = auth.uid() or current_user = 'freeze_rpc_trusted');

drop policy if exists "habits_select_own" on public.habits;
create policy "habits_select_own" on public.habits for select
  using (created_by_id = auth.uid() or current_user = 'freeze_rpc_trusted');

grant select on public.habits to freeze_rpc_trusted;
grant select on public.groups to freeze_rpc_trusted;
grant select, insert on public.freeze_assists to freeze_rpc_trusted;
grant select, insert on public.freeze_assist_notifications to freeze_rpc_trusted;

-- ============================================================
-- assist_streak_freeze: the write path. SECURITY DEFINER, owned by
-- freeze_rpc_trusted (same role apply_streak_freeze already uses) so the
-- column-lockdown trigger on streak_freezes and the widened policies
-- above both recognize it as trusted -- no new role needed.
-- ============================================================
create or replace function public.assist_streak_freeze(p_target_email text, p_habit_id uuid, p_missed_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := auth.jwt() ->> 'email';
  v_caller_is_pro boolean;
  v_caller_name text;
  v_target_id uuid;
  v_habit_owner_id uuid;
  v_habit_name text;
  v_shared_group boolean;
  v_record public.streak_freezes;
  v_month_key text := to_char(now(), 'YYYY-MM');
begin
  if v_caller_id is null or v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  if p_target_email = v_caller_email then
    raise exception 'You cannot assist your own streak -- use the regular freeze instead.';
  end if;

  -- Never trust a client-supplied "I'm Pro" flag -- same lesson
  -- apply_streak_freeze already applies to its own free/pro limit check.
  select (plan = 'pro') into v_caller_is_pro
  from public.user_profiles
  where created_by_id = v_caller_id;

  if not coalesce(v_caller_is_pro, false) then
    raise exception 'Freeze Assist is a Pro feature.';
  end if;

  -- created_by is server-stamped and immutable (20260914090001), so this
  -- join is trustworthy -- resolves the target's real auth id from the
  -- email the client named.
  select created_by_id into v_target_id
  from public.user_profiles
  where created_by = p_target_email;

  if v_target_id is null then
    raise exception 'Could not find that group member''s profile.';
  end if;

  -- Caller and target must actually share a group -- prevents assisting an
  -- arbitrary other user who merely happens to be resolvable by email.
  select exists (
    select 1 from public.groups g
    where g.member_emails @> array[v_caller_email]
      and g.member_emails @> array[p_target_email]
  ) into v_shared_group;

  if not v_shared_group then
    raise exception 'You can only assist a member of one of your own groups.';
  end if;

  -- The habit must genuinely belong to the target -- never trust a
  -- client-supplied habit_id blindly for a cross-user write.
  select created_by_id, name into v_habit_owner_id, v_habit_name
  from public.habits
  where id = p_habit_id;

  if v_habit_owner_id is null or v_habit_owner_id <> v_target_id then
    raise exception 'That habit does not belong to the named group member.';
  end if;

  -- Tighter window than apply_streak_freeze's own self-serve trust of a
  -- client-computed eligible date: this is a new cross-user trust
  -- boundary, so only yesterday or today may ever be assisted, regardless
  -- of what the client's own eligibility check claims.
  if p_missed_date < current_date - 1 or p_missed_date > current_date then
    raise exception 'Freeze Assist can only cover yesterday or today.';
  end if;

  -- Upsert the TARGET's current-month row -- same upsert-on-conflict
  -- shape as apply_streak_freeze, just keyed to the target instead of the
  -- caller, since this is now a genuinely cross-user write.
  insert into public.streak_freezes (created_by_id, user_email, month_key, used_count, frozen_habits)
  values (v_target_id, p_target_email, v_month_key, 0, '{}'::jsonb)
  on conflict (created_by_id, month_key) do update set created_by_id = excluded.created_by_id
  returning * into v_record;

  if v_record.frozen_habits ? p_habit_id::text then
    return jsonb_build_object('success', false, 'reason', 'This habit already has a freeze this month.');
  end if;

  -- Deliberately does NOT increment used_count: an assist is a gift funded
  -- by the ASSISTER's own Pro perk, not a charge against the recipient's
  -- own monthly allowance -- a Free-plan recipient's own 2 freezes stay
  -- untouched, and a Pro recipient's unlimited count is irrelevant either way.
  update public.streak_freezes
  set frozen_habits = coalesce(v_record.frozen_habits, '{}'::jsonb) || jsonb_build_object(p_habit_id::text, p_missed_date::text)
  where id = v_record.id
  returning * into v_record;

  select display_name into v_caller_name from public.user_profiles where created_by_id = v_caller_id;

  insert into public.freeze_assists (assister_id, assister_email, target_id, target_email, habit_id, missed_date)
  values (v_caller_id, v_caller_email, v_target_id, p_target_email, p_habit_id, p_missed_date)
  on conflict (target_id, habit_id, missed_date) do nothing;

  insert into public.freeze_assist_notifications (assister_email, assister_name, recipient_email, habit_name, missed_date)
  values (v_caller_email, coalesce(v_caller_name, split_part(v_caller_email, '@', 1)), p_target_email, v_habit_name, p_missed_date);

  return jsonb_build_object('success', true, 'record', to_jsonb(v_record));
end;
$$;

alter function public.assist_streak_freeze(text, uuid, date) owner to freeze_rpc_trusted;

revoke all on function public.assist_streak_freeze(text, uuid, date) from public;
grant execute on function public.assist_streak_freeze(text, uuid, date) to authenticated;

-- ============================================================
-- get_group_freeze_candidates: read-only discovery for the UI -- "which of
-- my groupmates currently have a habit eligible for a freeze". SECURITY
-- DEFINER owned by the default migration role (not freeze_rpc_trusted):
-- same bypass-RLS-via-table-ownership mechanism already used by
-- get_challenge_member_progress (20260813090001), appropriate here because
-- this only reads across members' habits, it never writes -- no need for a
-- dedicated trusted role's write privileges just to look.
--
-- Computed live, not cached: freeze eligibility depends on the calendar
-- date advancing even with zero new writes (same reasoning
-- get_challenge_member_progress's own comment gives for not caching
-- challenge progress), so a trigger-refreshed column would go stale the
-- day after a member's last habit write.
-- ============================================================
create or replace function public.get_group_freeze_candidates(p_group_id uuid, p_today date)
returns table(member_email text, habit_id uuid, habit_name text, missed_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_email text := auth.jwt() ->> 'email';
  v_group public.groups;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if v_group is null then
    raise exception 'Group not found';
  end if;

  if not (v_group.member_emails @> array[v_caller_email]) then
    raise exception 'Not a member of this group';
  end if;

  return query
  with members as (
    select m as member_email
    from unnest(v_group.member_emails) as m
    where m <> v_caller_email
  ),
  member_ids as (
    select mm.member_email, up.created_by_id
    from members mm
    join public.user_profiles up on up.created_by = mm.member_email
  ),
  candidate_habits as (
    select mi.member_email, h.id as habit_id, h.name as habit_name,
           coalesce(h.completions, '{}'::text[]) as completions, h.created_at,
           mi.created_by_id as owner_id
    from member_ids mi
    join public.habits h on h.created_by_id = mi.created_by_id
    where coalesce(h.archived, false) = false
  )
  select
    ch.member_email,
    ch.habit_id,
    ch.habit_name,
    (p_today - 1) as missed_date
  from candidate_habits ch
  where
    array_length(ch.completions, 1) > 0
    and not ((p_today - 1)::text = any(ch.completions))
    and not (p_today::text = any(ch.completions))
    and ch.created_at::date < (p_today - 1)
    and (select max(c) from unnest(ch.completions) as c) = (p_today - 2)::text
    and not exists (
      select 1 from public.streak_freezes sf
      where sf.created_by_id = ch.owner_id
        and sf.month_key = to_char(p_today, 'YYYY-MM')
        and sf.frozen_habits ? ch.habit_id::text
    );
end;
$$;

revoke all on function public.get_group_freeze_candidates(uuid, date) from public;
grant execute on function public.get_group_freeze_candidates(uuid, date) to authenticated;
