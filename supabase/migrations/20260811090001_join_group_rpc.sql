-- join_group: same shape as join_focus_session (20260807090001) -- RLS's
-- groups_select requires already being a member (or the creator) to
-- SELECT a row at all, and groups_update only allows the creator to
-- write. A non-member calling the client's plain .filter()/.update() to
-- look up a group by invite code and add themselves to member_emails was
-- therefore guaranteed to see zero rows at the lookup step alone -- RLS
-- hides the row before invite_code is ever compared, surfacing to the
-- client as a misleading "No group found with that code." for a group
-- that actually exists. Joining by code has never actually worked for
-- anyone but the creator. A SECURITY DEFINER RPC is the established
-- pattern here for "an authenticated user needs one narrow, validated
-- write to a row they don't own."
create or replace function public.join_group(p_invite_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_caller_email text := auth.jwt() ->> 'email';
begin
  if v_caller_email is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_group
  from public.groups
  where invite_code = upper(p_invite_code);

  if v_group is null then
    raise exception 'Group not found';
  end if;

  -- Already a member (creator, or a previous join): idempotent, just
  -- return the current row rather than erroring on a re-submit.
  if v_group.created_by_id = auth.uid() or v_group.member_emails @> array[v_caller_email] then
    return v_group;
  end if;

  update public.groups
  set member_emails = member_emails || array[v_caller_email]
  where id = v_group.id
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.join_group(text) from public;
grant execute on function public.join_group(text) to authenticated;
