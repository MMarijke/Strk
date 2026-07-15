-- RLS policies, translated 1:1 from the `rls` blocks in base44/entities/*.jsonc.
-- Base44's {{user.id}} -> auth.uid(), {{user.email}} -> public.current_email(),
-- user_condition: { role: "admin" } -> public.is_admin().

-- habits: owner-only (create/read/update/delete all created_by_id)
alter table public.habits enable row level security;
create policy "habits_select_own" on public.habits for select using (created_by_id = auth.uid());
create policy "habits_insert_own" on public.habits for insert with check (created_by_id = auth.uid());
create policy "habits_update_own" on public.habits for update using (created_by_id = auth.uid());
create policy "habits_delete_own" on public.habits for delete using (created_by_id = auth.uid());

-- user_profiles: read own or public; write own only
alter table public.user_profiles enable row level security;
create policy "user_profiles_select" on public.user_profiles for select
  using (created_by_id = auth.uid() or is_public = true);
create policy "user_profiles_insert_own" on public.user_profiles for insert
  with check (created_by_id = auth.uid());
create policy "user_profiles_update_own" on public.user_profiles for update
  using (created_by_id = auth.uid());
create policy "user_profiles_delete_own" on public.user_profiles for delete
  using (created_by_id = auth.uid());

-- groups: read by creator, member, or admin; write by creator or admin
alter table public.groups enable row level security;
create policy "groups_select" on public.groups for select
  using (
    created_by_id = auth.uid()
    or member_emails @> array[current_email()]
    or is_admin()
  );
create policy "groups_insert_own" on public.groups for insert
  with check (created_by_id = auth.uid());
create policy "groups_update" on public.groups for update
  using (created_by_id = auth.uid() or is_admin());
create policy "groups_delete" on public.groups for delete
  using (created_by_id = auth.uid() or is_admin());

-- group_challenges: same shape as groups
alter table public.group_challenges enable row level security;
create policy "group_challenges_select" on public.group_challenges for select
  using (
    created_by_id = auth.uid()
    or member_emails @> array[current_email()]
    or is_admin()
  );
create policy "group_challenges_insert_own" on public.group_challenges for insert
  with check (created_by_id = auth.uid());
create policy "group_challenges_update" on public.group_challenges for update
  using (created_by_id = auth.uid() or is_admin());
create policy "group_challenges_delete" on public.group_challenges for delete
  using (created_by_id = auth.uid() or is_admin());

-- focus_sessions: same shape, keyed on participant_emails instead of member_emails
alter table public.focus_sessions enable row level security;
create policy "focus_sessions_select" on public.focus_sessions for select
  using (
    created_by_id = auth.uid()
    or participant_emails @> array[current_email()]
    or is_admin()
  );
create policy "focus_sessions_insert_own" on public.focus_sessions for insert
  with check (created_by_id = auth.uid());
create policy "focus_sessions_update" on public.focus_sessions for update
  using (created_by_id = auth.uid() or is_admin());
create policy "focus_sessions_delete" on public.focus_sessions for delete
  using (created_by_id = auth.uid() or is_admin());

-- reactions: sender/recipient split (not owner-based)
alter table public.reactions enable row level security;
create policy "reactions_select" on public.reactions for select
  using (sender_email = current_email() or recipient_email = current_email());
create policy "reactions_insert_as_sender" on public.reactions for insert
  with check (sender_email = current_email());
create policy "reactions_update_as_recipient" on public.reactions for update
  using (recipient_email = current_email());
create policy "reactions_delete_as_sender" on public.reactions for delete
  using (sender_email = current_email());

-- challenge_notifications: creator can manage, recipient can read/dismiss
alter table public.challenge_notifications enable row level security;
create policy "challenge_notifications_select" on public.challenge_notifications for select
  using (created_by_id = auth.uid() or recipient_email = current_email());
create policy "challenge_notifications_insert_own" on public.challenge_notifications for insert
  with check (created_by_id = auth.uid());
create policy "challenge_notifications_update_as_recipient" on public.challenge_notifications for update
  using (recipient_email = current_email());
create policy "challenge_notifications_delete_own" on public.challenge_notifications for delete
  using (created_by_id = auth.uid());

-- streak_freezes: owner-only
alter table public.streak_freezes enable row level security;
create policy "streak_freezes_select_own" on public.streak_freezes for select
  using (created_by_id = auth.uid());
create policy "streak_freezes_insert_own" on public.streak_freezes for insert
  with check (created_by_id = auth.uid());
create policy "streak_freezes_update_own" on public.streak_freezes for update
  using (created_by_id = auth.uid());
create policy "streak_freezes_delete_own" on public.streak_freezes for delete
  using (created_by_id = auth.uid());

-- user_badges: owner-only
alter table public.user_badges enable row level security;
create policy "user_badges_select_own" on public.user_badges for select
  using (created_by_id = auth.uid());
create policy "user_badges_insert_own" on public.user_badges for insert
  with check (created_by_id = auth.uid());
create policy "user_badges_update_own" on public.user_badges for update
  using (created_by_id = auth.uid());
create policy "user_badges_delete_own" on public.user_badges for delete
  using (created_by_id = auth.uid());
