-- Focus session lobby: a 2-minute waiting period between session creation
-- and the actual focus timer starting, so other participants have time to
-- join before the countdown begins.
--
-- 'waiting' already existed as a status value (see core_tables.sql) and was
-- already checked for in JoinFocusModal.jsx, but no code path ever produced
-- it -- StartFocusModal created every session directly as 'active'. Reusing
-- it for the lobby rather than adding a new enum value.
--
-- lobby_ends_at plays the same role for the lobby that ends_at already
-- plays for the focus timer: a concrete deadline the UI counts down to and
-- that server-side logic checks against, rather than trusting each client's
-- own clock for "has the lobby elapsed" decisions.
alter table public.focus_sessions add column lobby_ends_at timestamptz;

-- ============================================================
-- join_focus_session: fixes a pre-existing bug, independent of the lobby
-- feature -- RLS's focus_sessions_select requires already being a
-- participant to SELECT a row at all, and focus_sessions_update only
-- allows the host to write. A non-host user calling the client's plain
-- .update() to add themselves to participant_emails was therefore
-- guaranteed to affect zero rows (blocked by both policies at once),
-- meaning joining by code has never actually worked for anyone but the
-- host. Same shape as apply_streak_freeze(): a SECURITY DEFINER RPC is the
-- established pattern in this codebase for "an authenticated user needs
-- one narrow, validated write to a row they don't own."
--
-- Also implements requirement 5: joining a session that's already 'active'
-- (lobby already elapsed) does NOT silently add the caller -- it raises a
-- distinguishable error so the client can show an explicit "session
-- already in progress, join anyway?" prompt, and only actually joins on a
-- second call with p_confirm_active = true.
create or replace function public.join_focus_session(p_session_code text, p_confirm_active boolean default false)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.focus_sessions;
  v_caller_email text := auth.jwt() ->> 'email';
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session
  from public.focus_sessions
  where session_code = upper(p_session_code)
    and status in ('waiting', 'active')
  limit 1;

  if v_session is null then
    raise exception 'Session not found or already ended';
  end if;

  -- Already a participant (e.g. rejoining after a refresh): idempotent,
  -- just return the current row regardless of status/confirmation.
  if v_session.participant_emails @> array[v_caller_email] then
    return v_session;
  end if;

  if v_session.status = 'active' and not p_confirm_active then
    raise exception 'SESSION_IN_PROGRESS';
  end if;

  update public.focus_sessions
  set participant_emails = participant_emails || array[v_caller_email]
  where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.join_focus_session(text, boolean) from public;
grant execute on function public.join_focus_session(text, boolean) to authenticated;

-- ============================================================
-- start_focus_session_now: the lobby -> active transition. Callable by any
-- authenticated user (any participant's client can notice the lobby has
-- elapsed and advance it -- not host-only, since the host's tab may be
-- closed/backgrounded when the natural deadline passes) for the natural
-- case, or by the host specifically with p_force = true to skip the
-- remaining countdown.
--
-- Race safety: the actual state-changing UPDATE is guarded by
-- `where status = 'waiting'`. If two clients call this within the same
-- moment, Postgres serializes the two UPDATEs on the row -- the first to
-- commit wins; the second's WHERE no longer matches the now-'active' row,
-- so it updates zero rows and `returning ... into v_session` leaves
-- v_session null. The function returns null in that case rather than
-- raising, and the caller treats null as "another client already started
-- it" and refetches instead of trusting its own started_at/ends_at.
create or replace function public.start_focus_session_now(p_session_id uuid, p_force boolean default false)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.focus_sessions;
  v_caller_email text := auth.jwt() ->> 'email';
begin
  select * into v_session from public.focus_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'Session not found';
  end if;

  if p_force and v_session.host_email is distinct from v_caller_email then
    raise exception 'Only the host can force-start a session early';
  end if;

  if not p_force and v_session.lobby_ends_at is not null and v_session.lobby_ends_at > now() then
    raise exception 'Lobby period has not elapsed yet';
  end if;

  update public.focus_sessions
  set status = 'active',
      started_at = now(),
      ends_at = now() + make_interval(mins => duration_minutes)
  where id = p_session_id
    and status = 'waiting'
  returning * into v_session;

  return v_session; -- null means another call already won the race
end;
$$;

revoke all on function public.start_focus_session_now(uuid, boolean) from public;
grant execute on function public.start_focus_session_now(uuid, boolean) to authenticated;
