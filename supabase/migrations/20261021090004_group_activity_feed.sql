-- The group activity feed: make the things this product does that a solo
-- tracker cannot -- sessions sat together, streaks saved for each other,
-- reactions sent -- visible on the screen where the group lives.
--
-- ============================================================
-- READ THIS FIRST: this migration widens who can see existing personal
-- data, and that is a deliberate product decision, not a side effect.
--
-- All three event sources are currently scoped by RLS to the two parties
-- involved, and nothing else:
--   reactions_select      -> sender_email or recipient_email (20260702120003)
--   freeze_assists_select -> assister_id or target_id        (20260915090003)
--   focus_sessions_select -> creator or participant_emails   (20260702120003)
--
-- So a reaction is today a private gesture between two people. After this
-- migration, every member of a group can see that it happened. Nobody
-- agreed to that when they sent one. Two things follow, and the second is
-- enforced here rather than left to the client:
--
--   1. Members must be told. A disclosure belongs on the group screen or
--      in Settings. Per CLAUDE.md, GDPR/POPIA applies and this is a change
--      of processing purpose for personal data already collected, not a
--      new collection -- so it needs saying out loud, not burying.
--
--   2. The window is bounded. get_group_activity below refuses any
--      p_since older than ACTIVITY_WINDOW (14 days). That is good design
--      on its own -- a feed of last March is not activity -- but its real
--      job here is to cap the retroactive exposure at a fortnight rather
--      than the entire history of the table. The ceiling is server-side
--      precisely so a client cannot widen it by passing a different date.
--
-- None of the underlying RLS policies are changed. This function is the
-- only widened path, it is the narrowest shape that does the job, and it
-- returns events rather than rows -- no habit names, no completion data,
-- no scores.

-- ============================================================
-- freeze_assists needs to record WHICH group an assist happened in.
--
-- It stores assister, target, habit and date -- nothing linking it to a
-- group. The feed could infer one by checking both parties are members,
-- but that is an inference, not a record: an assist between two people
-- who share two groups would appear in both feeds, and one given outside
-- any group context would surface in whichever group they happen to
-- share. Same honesty problem as the "{n} members tracking" card that was
-- just deleted -- a confident group-level claim derived from data that
-- does not actually say it.
--
-- reactions.group_id already works exactly this way, set at insert time by
-- send_reaction. This brings assists in line.
alter table public.freeze_assists
  add column if not exists group_id uuid references public.groups (id) on delete set null;

create index if not exists freeze_assists_group_id_idx
  on public.freeze_assists (group_id);

-- Existing rows stay null rather than being backfilled by guesswork, and
-- the feed skips null-group assists. For a row created before the column
-- existed there is no honest answer to "which group was this?", and
-- inventing one is worse than omitting the event.

-- ============================================================
-- assist_streak_freeze gains p_group_id.
--
-- The old three-argument signature is dropped rather than left alongside.
-- A fourth defaulted parameter creates an overload, and a PostgREST call
-- naming only the original three would then match both candidates and
-- fail as ambiguous -- the exact trap send_reaction hit in 20261021090002.
--
-- Everything else is preserved verbatim: the Pro check, the
-- not-your-own-streak guard, the yesterday-or-today window, the
-- deliberate non-increment of the recipient's used_count, the
-- notification insert, and the freeze_rpc_trusted ownership that
-- freeze_assists_insert_trusted and streak_freezes' policies all depend
-- on.
--
-- The shared-group check becomes stricter, not looser. It already proved
-- SOME group was shared; now it proves the specific group the caller
-- named is one both belong to. A caller cannot attribute an assist to a
-- group they are not in, which is what makes the recorded group_id worth
-- trusting in the feed.
drop function if exists public.assist_streak_freeze(text, uuid, date);

create or replace function public.assist_streak_freeze(
  p_target_email text,
  p_habit_id uuid,
  p_missed_date date,
  p_group_id uuid default null
)
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

  -- Never trust a client-supplied "I'm Pro" flag.
  select (plan = 'pro') into v_caller_is_pro
  from public.user_profiles
  where created_by_id = v_caller_id;

  if not coalesce(v_caller_is_pro, false) then
    raise exception 'Freeze Assist is a Pro feature.';
  end if;

  select created_by_id into v_target_id
  from public.user_profiles
  where created_by = p_target_email;

  if v_target_id is null then
    raise exception 'Could not find that group member''s profile.';
  end if;

  select created_by_id, name into v_habit_owner_id, v_habit_name
  from public.habits
  where id = p_habit_id;

  if v_habit_owner_id is null or v_habit_owner_id is distinct from v_target_id then
    raise exception 'That habit does not belong to the member you are assisting.';
  end if;

  -- When a group is named, it must be one BOTH belong to. When it is not,
  -- fall back to the original "any shared group" check so the write still
  -- succeeds -- the event is then simply not attributable to a group and
  -- stays out of every feed.
  if p_group_id is not null then
    select exists (
      select 1 from public.groups g
      where g.id = p_group_id
        and g.member_emails @> array[v_caller_email]
        and g.member_emails @> array[p_target_email]
    ) into v_shared_group;

    if not v_shared_group then
      raise exception 'You can only assist a member of a group you are both in.';
    end if;
  else
    select exists (
      select 1 from public.groups g
      where g.member_emails @> array[v_caller_email]
        and g.member_emails @> array[p_target_email]
    ) into v_shared_group;

    if not v_shared_group then
      raise exception 'You can only assist a member of one of your own groups.';
    end if;
  end if;

  if p_missed_date < current_date - 1 or p_missed_date > current_date then
    raise exception 'Freeze Assist can only cover yesterday or today.';
  end if;

  insert into public.streak_freezes (created_by_id, user_email, month_key, used_count, frozen_habits)
  values (v_target_id, p_target_email, v_month_key, 0, '{}'::jsonb)
  on conflict (created_by_id, month_key) do update set created_by_id = excluded.created_by_id
  returning * into v_record;

  if v_record.frozen_habits ? p_habit_id::text then
    return jsonb_build_object('success', false, 'reason', 'This habit already has a freeze this month.');
  end if;

  -- Deliberately does NOT increment used_count: an assist is a gift funded
  -- by the ASSISTER's own Pro perk, not a charge against the recipient's
  -- own monthly allowance.
  update public.streak_freezes
  set frozen_habits = coalesce(v_record.frozen_habits, '{}'::jsonb) || jsonb_build_object(p_habit_id::text, p_missed_date::text)
  where id = v_record.id
  returning * into v_record;

  select display_name into v_caller_name from public.user_profiles where created_by_id = v_caller_id;

  insert into public.freeze_assists (assister_id, assister_email, target_id, target_email, habit_id, missed_date, group_id)
  values (v_caller_id, v_caller_email, v_target_id, p_target_email, p_habit_id, p_missed_date, p_group_id)
  on conflict (target_id, habit_id, missed_date) do nothing;

  insert into public.freeze_assist_notifications (assister_email, assister_name, recipient_email, habit_name, missed_date)
  values (v_caller_email, coalesce(v_caller_name, split_part(v_caller_email, '@', 1)), p_target_email, v_habit_name, p_missed_date);

  return jsonb_build_object('success', true, 'record', to_jsonb(v_record));
end;
$$;

alter function public.assist_streak_freeze(text, uuid, date, uuid) owner to freeze_rpc_trusted;
revoke all on function public.assist_streak_freeze(text, uuid, date, uuid) from public;
grant execute on function public.assist_streak_freeze(text, uuid, date, uuid) to authenticated;

-- ============================================================
-- get_group_activity: the feed.
--
-- SECURITY DEFINER because every source table is scoped to the parties
-- involved. Caller membership is therefore checked explicitly -- DEFINER
-- bypasses the policies that would otherwise have protected these reads,
-- so the check has to be written out, the same way complete_focus_session
-- and leave_focus_session do it.
--
-- Returns a flat event shape rather than rows from three tables, so the
-- client renders one list and learns nothing it was not given: no habit
-- names, no completions, no scores, no emails beyond the two parties to
-- each event.
create or replace function public.get_group_activity(
  p_group_id uuid,
  p_since timestamptz default null
)
returns table (
  kind text,
  occurred_at timestamptz,
  actor_email text,
  subject_email text,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_email text := auth.jwt() ->> 'email';
  v_members text[];
  -- The retroactive-exposure ceiling. See this file's header: a client
  -- cannot widen the window by passing an older p_since.
  v_window_start timestamptz := greatest(
    coalesce(p_since, now() - interval '14 days'),
    now() - interval '14 days'
  );
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select g.member_emails into v_members
  from public.groups g
  where g.id = p_group_id;

  if v_members is null then
    raise exception 'Group not found';
  end if;

  if not v_members @> array[v_caller_email] then
    raise exception 'Not a member of this group';
  end if;

  return query
  -- Completed sessions belonging to this group. 'waiting' and 'active'
  -- are excluded: a session in progress is not yet something that
  -- happened, and SessionRoom already surfaces live ones.
  select
    'session'::text,
    coalesce(s.ends_at, s.updated_at),
    s.host_email,
    null::text,
    -- Participants are carried as a count, not a list: the feed line
    -- names the host and says how many sat with them, which is all the
    -- sentence needs and avoids emitting an arbitrary-length email list.
    coalesce(array_length(s.participant_emails, 1), 0)::text
  from public.focus_sessions s
  where s.group_id = p_group_id
    and s.status = 'completed'
    and coalesce(s.ends_at, s.updated_at) >= v_window_start

  union all

  -- Freeze assists recorded against this group. Null-group rows -- every
  -- row predating the column above -- are skipped rather than guessed at.
  select
    'assist'::text,
    fa.created_at,
    fa.assister_email,
    fa.target_email,
    null::text
  from public.freeze_assists fa
  where fa.group_id = p_group_id
    and fa.created_at >= v_window_start

  union all

  -- Reactions sent inside this group.
  --
  -- Only the group_id path. 20261021090002 adds reactions.focus_session_id
  -- as a second provenance for reactions sent from a session's completion
  -- screen; that migration is not merged yet, so this deliberately does
  -- not reference the column. Adding it is a one-line OR against the
  -- session's own group_id once it lands -- noted here so the gap is a
  -- known follow-up rather than an oversight.
  select
    'reaction'::text,
    r.created_at,
    r.sender_email,
    r.recipient_email,
    r.emoji
  from public.reactions r
  where r.group_id = p_group_id
    and r.created_at >= v_window_start

  order by 2 desc
  limit 40;
end;
$$;

revoke all on function public.get_group_activity(uuid, timestamptz) from public;
grant execute on function public.get_group_activity(uuid, timestamptz) to authenticated;
