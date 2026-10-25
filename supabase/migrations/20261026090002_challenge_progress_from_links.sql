-- PR 2 of 3: get_challenge_member_progress resolves each member's habit
-- from challenge_habit_links (20261026090001) instead of matching a name.
--
-- The old matching was:
--
--   where h.created_by = m.member_email
--     and lower(h.name) = lower(v_challenge.habit_name)
--   limit 1
--
-- which meant a member tracking the same thing under a different name
-- showed 0% for the whole challenge, with no way to fix it short of
-- renaming their habit to match a string they had to guess.
--
-- Two defects in that query go with it:
--
--   1. It never filtered archived habits, while
--      complete_habit_from_focus_session always did. So a retired habit's
--      completions counted toward a live leaderboard -- the same leak
--      20261025090002 closed for the profile stat columns. Links are
--      refused for archived habits at link time, and a habit archived
--      AFTER linking now reports as such rather than silently counting.
--   2. `limit 1` had no ORDER BY, so which habit won when a member had
--      two by the same name was arbitrary. A link is unique per
--      (challenge, user), so the question no longer exists.
--
-- ============================================================
-- no_matching_habit becomes link_state
-- ============================================================
--
-- One discriminated value rather than a boolean, for the reason
-- 20261025090001 had to go and fix in the focus session: a boolean cannot
-- carry three outcomes, and a client handed an ambiguous value will guess.
--
--   'linked'      -- a link exists and the habit is active; the numbers mean something
--   'not_linked'  -- on the roster, no habit chosen yet. NOT a score of 0
--   'archived'    -- chose a habit, has since retired it
--
-- 'archived' is deliberately not folded into 'not_linked': the member DID
-- choose, so telling them to pick one would be wrong, and telling the
-- group they never joined would be wrong too.
--
-- Changing a column name in `returns table` is a return-type change, so
-- CREATE OR REPLACE cannot do it -- the DROP is mandatory, not stylistic.

drop function if exists public.get_challenge_member_progress(uuid, text[], date);

create or replace function public.get_challenge_member_progress(
  p_challenge_id uuid,
  p_elapsed_dates text[],
  p_today date
)
returns table(email text, completed_days integer, streak integer, link_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_email text := auth.jwt() ->> 'email';
  v_challenge public.group_challenges;
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge
  from public.group_challenges
  where id = p_challenge_id;

  if v_challenge is null then
    raise exception 'Challenge not found';
  end if;

  -- Explicit authorization check -- SECURITY DEFINER means RLS on
  -- group_challenges was bypassed above, so this can't rely on RLS
  -- having already scoped visibility to the caller.
  if not (v_challenge.member_emails @> array[v_caller_email]) then
    raise exception 'Not a member of this challenge';
  end if;

  return query
  with members as (
    select unnest(v_challenge.member_emails) as member_email
  ),
  -- The roster is still member_emails, and it still drives the rows: a
  -- member with no link appears, with link_state 'not_linked'. Linking is
  -- about which habit counts, not about who is in the challenge.
  linked as (
    select
      m.member_email,
      -- Nulled here rather than in the SELECT below, so there is exactly
      -- one representation of "nothing to count" and the window subquery
      -- cannot accidentally read the raw array.
      case when coalesce(h.archived, false) then null else h.completions end as completions,
      case
        when l.habit_id is null then 'not_linked'
        when coalesce(h.archived, false) then 'archived'
        else 'linked'
      end as link_state
    from members m
    left join public.challenge_habit_links l
      on l.challenge_id = p_challenge_id
     and l.user_email = m.member_email
    left join public.habits h
      on h.id = l.habit_id
  ),
  challenge_window as (
    select
      ln.member_email,
      ln.completions,
      ln.link_state,
      (
        select array_agg(c)
        from unnest(ln.completions) as c
        where c >= v_challenge.start_date::text and c <= v_challenge.end_date::text
      ) as challenge_completions
    from linked ln
  )
  select
    cw.member_email,
    (
      select count(*)
      from unnest(p_elapsed_dates) as d
      where cw.completions is not null and d = any(cw.completions)
    )::integer as completed_days,
    case
      when cw.link_state <> 'linked' then 0
      when cw.challenge_completions is null or array_length(cw.challenge_completions, 1) is null then 0
      else public.calculate_streak_from_dates(cw.challenge_completions, p_today)
    end as streak,
    cw.link_state
  from challenge_window cw;
end;
$$;

revoke all on function public.get_challenge_member_progress(uuid, text[], date) from public;
grant execute on function public.get_challenge_member_progress(uuid, text[], date) to authenticated;
