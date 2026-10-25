-- complete_habit_from_focus_session returned a nullable date, and null was
-- carrying four different meanings. The client could not tell them apart,
-- so it guessed -- and guessed wrong in a way that stated something untrue
-- to the user.
--
-- 20261021090003's own header claimed the opposite: "Returns the day
-- string it wrote, or null when there was nothing to do, so the client can
-- say which of the three outcomes happened rather than guessing: completed,
-- already complete, or no matching habit." One null cannot carry three
-- outcomes. SessionRoom.jsx then did
--
--   setHabitOutcome(data ? "completed" : "already")
--
-- under a comment asserting that "already done today" is distinguished from
-- "you track no habit by that name". It was not distinguished anywhere.
--
-- The result: a participant who joins a session attached to a habit they do
-- not have is told that habit "was already done today" -- a confident claim
-- about a habit they have never tracked. On a product whose premise is
-- joining other people's sessions, that is the common case, not the edge
-- case: the host attaches THEIR habit, and habit_name is matched
-- case-insensitively against each participant's own habits (the
-- cross-member name matching ChallengeLeaderboard already uses).
--
-- So the return type becomes the outcome itself. The date it wrote is not
-- returned because nothing ever used it: the client stamps its own local
-- day and only ever read the value for truthiness.
--
-- A DROP is mandatory, not stylistic -- CREATE OR REPLACE cannot change a
-- function's return type. Same signature, so no PostgREST overload is
-- created either way.

drop function if exists public.complete_habit_from_focus_session(uuid, text);

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
  v_archived_exists boolean;
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
    return 'no_habit_attached';
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
    -- Archived is its own outcome rather than being folded into
    -- 'no_habit'. The user DOES track this habit, they have just retired
    -- it, so telling them it is not one of their habits would be the same
    -- species of false statement this migration exists to remove.
    select exists (
      select 1 from public.habits h
      where h.created_by_id = auth.uid()
        and h.archived
        and lower(h.name) = lower(v_session.habit_name)
    ) into v_archived_exists;

    if v_archived_exists then
      return 'archived';
    end if;
    return 'no_habit';
  end if;

  -- Idempotent: already complete for that day is a no-op, not a second
  -- entry. Every participant's client fires this at the same second and a
  -- rejoin can fire it again, so this has to be safe to call repeatedly.
  if v_habit.completions @> array[v_day] then
    return 'already_done';
  end if;

  update public.habits
  set completions = completions || array[v_day]
  where id = v_habit.id;

  return 'completed';
end;
$$;

revoke all on function public.complete_habit_from_focus_session(uuid, text) from public;
grant execute on function public.complete_habit_from_focus_session(uuid, text) to authenticated;
