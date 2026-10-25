-- PR 3 of 3: complete_habit_from_focus_session credits the habit the
-- participant LINKED (20261026090001) instead of the one whose name happens
-- to match the host's.
--
-- This is the last server-side name match in the codebase. After it,
-- `lower(h.name) = lower(...)` appears nowhere in any read or write path --
-- only as a client-side pre-selection the user can override.
--
-- ============================================================
-- A deviation from the shape brief, stated rather than quietly taken
-- ============================================================
--
-- The brief said join_focus_session would gain an optional habit argument
-- so joining and linking were one call. It does not, and the signature is
-- untouched:
--
--   * link_focus_session_habit already exists (20261026090001) and already
--     carries exactly this write, with its own validation and its own
--     errors. Adding a second path to the same row would be the "two
--     creation paths for the same thing" pattern focusSessionStart.js was
--     extracted specifically to avoid.
--   * join_focus_session already has a defaulted parameter, so adding
--     another means a DROP and a signature change on the one RPC that
--     gates every join -- real risk for no behaviour the lobby cannot
--     already express.
--   * Linking is changeable during the lobby; joining is not. A value that
--     changes does not belong in an idempotent join that returns early for
--     an existing participant.
--
-- The brief's actual decision -- the participant links in the lobby, with
-- a name match pre-selecting it -- is unaffected. Only which function
-- carries the write changed.

-- ============================================================
-- The host's own link, created with the session.
--
-- startFocusSession writes session.habit_id, which by construction is the
-- HOST's own habit (habits_select_own is owner-only, so no client can
-- resolve anyone else's). Without this the host would attach a habit,
-- start a session, and get no credit -- the link table would have a row
-- for every participant who picked one in the lobby and none for the
-- person whose habit the session is named after.
--
-- SECURITY DEFINER, which is required rather than preferred:
-- focus_session_habit_links has no insert policy at all, so an insert in
-- the host's own RLS context is denied by default. The function never
-- needs to know who is calling -- it reads NEW -- so the CLAUDE.md trap
-- about DEFINER resetting current_user does not apply here.
--
-- The exception backstop is the important part. protect_habit_link_owner
-- raises if the denormalised columns disagree, and an AFTER INSERT trigger
-- that raises would abort the session creation itself. A host must always
-- be able to start a session; failing to pre-link their habit is a
-- recoverable inconvenience they can fix from the lobby picker, so it
-- degrades to a warning. Same reasoning as
-- sync_profile_stats_from_habits' own backstop: a derived convenience must
-- never abort the user's real action.
-- ============================================================
create or replace function public.link_host_habit_on_session_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.habit_id is null then
    return new;
  end if;

  insert into public.focus_session_habit_links (session_id, user_id, user_email, habit_id)
  values (new.id, new.created_by_id, new.host_email, new.habit_id)
  on conflict (session_id, user_id) do nothing;

  return new;
exception when others then
  raise warning 'link_host_habit_on_session_create: could not pre-link habit % for session %: %',
    new.habit_id, new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists link_host_habit_on_session_create_trigger on public.focus_sessions;
create trigger link_host_habit_on_session_create_trigger
  after insert on public.focus_sessions
  for each row execute function public.link_host_habit_on_session_create();

-- Backfill the host link for sessions that already exist and are still
-- live. Deliberately narrow: a focus session lasts 25 to 60 minutes, so
-- anything already 'completed' has had its credit decided and rewriting
-- its links would change nothing. Only 'waiting' and 'active' sessions can
-- still be credited.
insert into public.focus_session_habit_links (session_id, user_id, user_email, habit_id)
select fs.id, fs.created_by_id, fs.host_email, fs.habit_id
from public.focus_sessions fs
join public.habits h
  on h.id = fs.habit_id
 and h.created_by_id = fs.created_by_id
 and h.created_by = fs.host_email
where fs.habit_id is not null
  and fs.status in ('waiting', 'active')
on conflict (session_id, user_id) do nothing;

-- ============================================================
-- complete_habit_from_focus_session: credits the LINKED habit.
--
-- The outcome enum from 20261025090001 survives; one value changes
-- meaning and name:
--
--   'completed'          -- written
--   'already_done'       -- that day was already recorded
--   'not_linked'         -- was 'no_habit'. The participant linked nothing
--   'archived'           -- linked, then retired the habit
--   'no_habit_attached'  -- the HOST attached nothing, so nobody links
--
-- 'no_habit' becomes 'not_linked' because the value should say what it
-- means: the participant no longer needs to own a same-named habit, they
-- need to have picked one. Keeping the old name would describe a condition
-- that no longer exists.
--
-- 'archived' is still reachable even though link_focus_session_habit
-- refuses an archived habit: a habit can be archived AFTER being linked.
--
-- Return type is unchanged (text), so no DROP is needed -- but the
-- function is replaced in full rather than patched, because the
-- authorisation path above the resolution is what makes it safe to read
-- and should stay in one piece.
-- ============================================================
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
  v_link public.focus_session_habit_links;
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

  if v_session.habit_name is null and v_session.habit_id is null then
    return 'no_habit_attached';
  end if;

  -- The caller's own link. No name matching: a participant is credited for
  -- the habit they picked, whatever it is called.
  select * into v_link
  from public.focus_session_habit_links
  where session_id = p_session_id
    and user_id = auth.uid();

  if v_link is null then
    return 'not_linked';
  end if;

  select * into v_habit
  from public.habits h
  where h.id = v_link.habit_id
    and h.created_by_id = auth.uid();

  -- The link cascades off habits, so a deleted habit leaves no link and is
  -- already 'not_linked' above. This covers the row being unreadable for
  -- any other reason, and is treated as not linked rather than silently
  -- writing nothing.
  if v_habit is null then
    return 'not_linked';
  end if;

  if coalesce(v_habit.archived, false) then
    return 'archived';
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
