-- The app reads/filters on a denormalized "created_by" email field directly
-- (e.g. group.created_by === userEmail), mirroring Base44's implicit dual
-- owner fields (created_by_id + created_by). Add the email counterpart here,
-- auto-populated from the JWT at insert time, alongside the existing
-- created_by_id uuid used by RLS.

alter table public.habits add column created_by text not null default public.current_email();
alter table public.user_profiles add column created_by text not null default public.current_email();
alter table public.groups add column created_by text not null default public.current_email();
alter table public.group_challenges add column created_by text not null default public.current_email();
alter table public.focus_sessions add column created_by text not null default public.current_email();
alter table public.reactions add column created_by text not null default public.current_email();
alter table public.challenge_notifications add column created_by text not null default public.current_email();
alter table public.streak_freezes add column created_by text not null default public.current_email();
alter table public.user_badges add column created_by text not null default public.current_email();

create index habits_created_by_idx on public.habits (created_by);
create index user_profiles_created_by_idx on public.user_profiles (created_by);
create index groups_created_by_idx on public.groups (created_by);
create index group_challenges_created_by_idx on public.group_challenges (created_by);
