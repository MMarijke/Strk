-- Attach a focus session to a habit, so finishing one advances the streak
-- it belongs to.
--
-- A focus session had no relationship to any habit, streak or rank, which
-- is why the design critique called the surface a pomodoro timer that could
-- ship in any app. PRODUCT.md's bet is that "streaks survive longer when
-- friends join you in the moment"; until now the session and the streak
-- were two unconnected things that happened to live in the same product.
--
-- Note what this migration does NOT need to touch:
-- sync_profile_stats_from_habits (latest version in 20261020090001)
-- derives best_streak, consistency_score, total_completions and
-- last_completion_date entirely from habits.completions. Because a
-- finished session writes a day string into that array -- the same value a
-- manual tap writes -- every stat, badge and leaderboard number follows
-- through machinery that already exists and is already locked down. The
-- trigger is deliberately left alone.

-- ============================================================
-- habit_id + habit_name, exactly as group_challenges does it.
--
-- habit_id can only ever be the HOST's habit: habits_select_own
-- (20260702120003) is strictly owner-only, so no client session can
-- resolve another user's habit rows at all. That is the same wall
-- 20260810090001 hit with group_challenges.habit_id, and its comment is
-- explicit that a single habit_id "structurally can't replace" per-member
-- resolution without a much larger redesign (a real per-member join
-- table). This migration does not attempt that redesign either.
--
-- So habit_name rides along as a frozen snapshot taken at creation, and
-- each other participant's client matches it case-insensitively against
-- their own habits -- the same cross-member name matching
-- ChallengeLeaderboard.getStatsForMember already does. A participant with
-- no matching habit simply gets nothing written, and is told so.
--
-- Both nullable: a session with no habit is the default and behaves
-- exactly as before. `on delete set null` rather than restrict, unlike
-- group_challenges: a challenge is about its habit for weeks, but a
-- finished focus session is a historical record, and deleting a habit
-- should not be blocked by sessions that already happened.
alter table public.focus_sessions
  add column if not exists habit_id uuid references public.habits (id) on delete set null;

alter table public.focus_sessions
  add column if not exists habit_name text;

-- ============================================================
-- complete_habit_from_focus_session: the write path.
--
-- habits.completions is a plain text[] with no append-only path, and
-- reject_future_habit_completions (20260914090005) guards only future
-- dates -- its own header notes that bounding writes further was
-- considered and left open. So "a session completed my habit" must not be
-- something a client can simply assert: it is authorised here, on the two
-- conditions complete_focus_session (20261021090001) already established
-- for this table -- the caller is a participant, and the clock has passed
-- ends_at.
--
-- SECURITY DEFINER is needed to read focus_sessions for the authorisation
-- check without depending on the caller's SELECT policy, but the habit it
-- writes is always resolved by created_by_id = auth.uid(): a caller can
-- only ever complete their OWN habit, never the host's and never anyone
-- else's. The function takes no habit argument at all for that reason.
--
-- Returns the day string it wrote, or null when there was nothing to do,
-- so the client can say which of the three outcomes happened rather than
-- guessing: completed, already complete, or no matching habit.
create or replace function public.complete_habit_from_focus_session(p_session_id uuid, p_local_date text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.focus_sessions;
  v_caller_email text := auth.jwt() ->> 'email';
  v_habit public.habits;
  v_day text;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  -- The client's own local calendar day, for the same reason
  -- Dashboard.handleToggleToday stamps completions with the client's
  -- "today": a user in UTC+14 can legitimately be a day ahead of the
  -- server. Validated and bounded here rather than trusted -- the +1 day
  -- of grace matches reject_future_habit_completions' own allowance, so
  -- this can never write a day that trigger would reject.
  if p_local_date is null or p_local_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'A valid YYYY-MM-DD local date is required';
  end if;
  if p_local_date::date > current_date + 1 or p_local_date::date < current_date - 1 then
    raise exception 'Local date is too far from the server date to be plausible';
  end if;
  v_day := p_local_date;

  select * into v_session from public.focus_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'Session not found';
  end if;

  if not v_session.participant_emails @> array[v_caller_email] then
    raise exception 'Not a participant in this session';
  end if;

  -- Only a session that actually ran its course completes anything. A
  -- host ending early means the session did not happen, so there is
  -- nothing to credit -- the client says as much on that screen.
  if v_session.ends_at is null or now() < v_session.ends_at then
    raise exception 'Session has not reached its end time yet';
  end if;

  if v_session.habit_name is null then
    return null; -- no habit was attached; nothing to do
  end if;

  -- The caller's OWN habit, matched on the frozen name. Archived habits
  -- are excluded: an archived habit is one the user has stopped tracking,
  -- and silently reviving its streak would be a surprise.
  select * into v_habit
  from public.habits h
  where h.created_by_id = auth.uid()
    and not h.archived
    and lower(h.name) = lower(v_session.habit_name)
  order by h.created_at
  limit 1;

  if v_habit is null then
    return null; -- this participant tracks no habit by that name
  end if;

  -- Idempotent: already complete for that day is a no-op, not a second
  -- entry. Every participant's client fires this at the same second and a
  -- rejoin can fire it again, so this has to be safe to call repeatedly.
  if v_habit.completions @> array[v_day] then
    return null;
  end if;

  update public.habits
  set completions = completions || array[v_day]
  where id = v_habit.id;

  return v_day;
end;
$$;

revoke all on function public.complete_habit_from_focus_session(uuid, text) from public;
grant execute on function public.complete_habit_from_focus_session(uuid, text) to authenticated;

-- ============================================================
-- Freeze the attachment after creation.
--
-- Same reasoning as 20260914090003, which locked down group_challenges'
-- habit fields: habit_name is a snapshot other participants match
-- against, so a host who could rewrite it mid-session could redirect
-- everyone else's completion to a different habit. habit_id is the
-- validated reference it was taken from and moves with it.
--
-- SECURITY INVOKER, not DEFINER -- the CLAUDE.md trap: a DEFINER trigger
-- function resets current_user to its own owner the moment it starts, so
-- any check against the caller silently fails. This one only compares OLD
-- and NEW and needs no role check at all, but it stays INVOKER so that it
-- cannot quietly acquire the owner's privileges either.
create or replace function public.protect_focus_session_habit_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.habit_id is distinct from old.habit_id
    or new.habit_name is distinct from old.habit_name
  )
    -- IS DISTINCT FROM, not !=: auth.role() is NULL on any connection with
    -- no JWT context, and != against NULL is NULL, which is falsy in IF
    -- and would silently allow the write. Fail closed.
    and auth.role() is distinct from 'service_role'
  then
    raise exception 'habit_id and habit_name are frozen at session creation and cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_focus_session_habit_fields_trigger on public.focus_sessions;
create trigger protect_focus_session_habit_fields_trigger
  before update on public.focus_sessions
  for each row execute function public.protect_focus_session_habit_fields();
