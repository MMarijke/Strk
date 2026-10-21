-- Focus sessions: two narrow writes a participant legitimately needs but
-- RLS correctly refuses to let them make directly.
--
-- focus_sessions_update (20260702120003) is
-- `using (created_by_id = auth.uid() or is_admin())` -- host-only, which is
-- right: nobody but the host should be able to retime or retitle somebody
-- else's session. But it leaves two real actions with no path at all, and
-- the client has been quietly failing at both.
--
-- Same shape as join_focus_session (20260807090001) and
-- apply_streak_freeze: a SECURITY DEFINER RPC is this codebase's
-- established answer to "an authenticated user needs one narrow, validated
-- write to a row they don't own".

-- ============================================================
-- leave_focus_session: actually leave, rather than just closing the room.
--
-- SessionRoom's close button calls onClose(), which sets activeSession to
-- null on the Dashboard. That removes the participant from the *room* and
-- not from participant_emails -- so FocusSessionBanner, which looks for any
-- 'waiting'/'active' session containing the caller's email, immediately
-- offers "Focus session active · tap to return". There has never been a way
-- to leave a session joined by mistake; the UI offered an exit that put
-- you straight back in the queue to re-enter.
--
-- Deliberately refuses the host. A host leaving their own session is
-- ambiguous -- does the session continue without them? -- and the honest
-- host action already exists and is destructive and separate ("End for
-- everyone"). Rather than invent a third meaning, this raises and the UI
-- shows hosts the end action instead. Note the host would also lose SELECT
-- on the row if they removed themselves while keeping created_by_id, which
-- is a second reason not to make this the host's exit.
create or replace function public.leave_focus_session(p_session_id uuid)
returns void
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

  select * into v_session from public.focus_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'Session not found';
  end if;

  if v_session.host_email is not distinct from v_caller_email then
    raise exception 'The host cannot leave their own session; end it instead';
  end if;

  -- Idempotent: leaving a session you are not in is a no-op, not an error.
  -- A double-tap, or a leave racing the 15s poll, must not surface a
  -- failure for an action that already achieved what the user wanted.
  update public.focus_sessions
  set participant_emails = array_remove(participant_emails, v_caller_email)
  where id = p_session_id;
end;
$$;

revoke all on function public.leave_focus_session(uuid) from public;
grant execute on function public.leave_focus_session(uuid) to authenticated;

-- ============================================================
-- complete_focus_session: let any participant close out a session whose
-- deadline has genuinely passed.
--
-- SessionRoom's timer fires FocusSession.update(id, { status: 'completed' })
-- the moment its countdown hits zero, from whichever clients are watching.
-- Under focus_sessions_update that write matches zero rows for every
-- non-host, and entities.js's .update() ends in .select().single(), which
-- throws on zero rows -- so every non-host finishing a session has been
-- firing a guaranteed-to-fail write and an unhandled promise rejection. The
-- completion screen rendered anyway (it is driven by local state), which is
-- exactly why this went unnoticed.
--
-- The consequence was not only noise: if the host's tab was closed or
-- backgrounded when the timer elapsed, nobody could write the status, so
-- the row stayed 'active' indefinitely. FocusSessionBanner masks that by
-- also filtering on ends_at > now(), so users were not stranded -- but the
-- data stayed wrong.
--
-- `now() >= ends_at` is the whole authorisation story here, and it is what
-- makes this safe to open up: a participant can only ratify an ending the
-- clock has already decided. Ending a session *early* stays host-only,
-- through the ordinary RLS-governed update.
create or replace function public.complete_focus_session(p_session_id uuid)
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

  select * into v_session from public.focus_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'Session not found';
  end if;

  -- Participants and the host only. Checked explicitly rather than relying
  -- on the SELECT policy, because SECURITY DEFINER bypasses RLS entirely --
  -- the policy that would have protected this read is not in force inside
  -- this function, so the check has to be written out.
  if not (
    v_session.participant_emails @> array[v_caller_email]
    or v_session.host_email is not distinct from v_caller_email
  ) then
    raise exception 'Not a participant in this session';
  end if;

  if v_session.ends_at is null or now() < v_session.ends_at then
    raise exception 'Session has not reached its end time yet';
  end if;

  -- `where status <> 'completed'` makes concurrent calls harmless: every
  -- participant's client fires this at the same second, and the losers
  -- update zero rows. Unlike start_focus_session_now, which has to report
  -- the race so the caller can refetch the times it did not set, there is
  -- nothing to learn from losing here -- the end state is identical either
  -- way -- so this returns the row as it stands rather than null.
  update public.focus_sessions
  set status = 'completed'
  where id = p_session_id
    and status <> 'completed';

  select * into v_session from public.focus_sessions where id = p_session_id;
  return v_session;
end;
$$;

revoke all on function public.complete_focus_session(uuid) from public;
grant execute on function public.complete_focus_session(uuid) to authenticated;
