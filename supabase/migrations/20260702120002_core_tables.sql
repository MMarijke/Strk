-- Core entity tables, ported field-for-field from base44/entities/*.jsonc.

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  color text,
  completions text[] not null default '{}',
  description text,
  goal_per_week integer,
  reminder_time text,
  reminder_days integer[] not null default '{}',
  category text check (category in ('health', 'fitness', 'mindfulness', 'learning', 'productivity', 'social', 'other')),
  archived boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index habits_created_by_id_idx on public.habits (created_by_id);
create trigger habits_set_updated_at before update on public.habits
  for each row execute function public.set_updated_at();

create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_color text,
  total_completions integer not null default 0,
  best_streak integer not null default 0,
  consistency_score numeric not null default 0,
  is_public boolean not null default true,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  highest_rank text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index user_profiles_created_by_id_key on public.user_profiles (created_by_id);
create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  member_emails text[] not null default '{}',
  color text,
  invite_code text unique,
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index groups_member_emails_idx on public.groups using gin (member_emails);
create trigger groups_set_updated_at before update on public.groups
  for each row execute function public.set_updated_at();

create table public.group_challenges (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  habit_name text not null,
  description text,
  duration_days integer not null check (duration_days in (7, 14, 30)),
  start_date date not null,
  end_date date,
  member_emails text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index group_challenges_group_id_idx on public.group_challenges (group_id);
create index group_challenges_member_emails_idx on public.group_challenges using gin (member_emails);
create trigger group_challenges_set_updated_at before update on public.group_challenges
  for each row execute function public.set_updated_at();

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  host_email text not null,
  host_name text,
  group_id uuid references public.groups (id) on delete set null,
  duration_minutes integer not null check (duration_minutes in (25, 45, 60)),
  started_at timestamptz,
  ends_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed')),
  participant_emails text[] not null default '{}',
  session_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index focus_sessions_session_code_idx on public.focus_sessions (session_code);
create index focus_sessions_participant_emails_idx on public.focus_sessions using gin (participant_emails);
create trigger focus_sessions_set_updated_at before update on public.focus_sessions
  for each row execute function public.set_updated_at();

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null,
  sender_email text not null,
  sender_name text,
  recipient_email text not null,
  group_id uuid references public.groups (id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index reactions_sender_email_idx on public.reactions (sender_email);
create index reactions_recipient_email_idx on public.reactions (recipient_email);

create table public.challenge_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  challenge_id uuid not null references public.group_challenges (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  group_name text,
  habit_name text not null,
  duration_days integer,
  started_by_email text,
  started_by_name text,
  recipient_email text not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create index challenge_notifications_recipient_email_idx on public.challenge_notifications (recipient_email);

create table public.streak_freezes (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  week_key text not null,
  used_count integer not null default 0,
  frozen_habits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index streak_freezes_owner_week_key on public.streak_freezes (created_by_id, week_key);
create trigger streak_freezes_set_updated_at before update on public.streak_freezes
  for each row execute function public.set_updated_at();

create table public.user_badges (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  badge_id text not null,
  earned_date date not null,
  created_at timestamptz not null default now()
);
create unique index user_badges_owner_badge_key on public.user_badges (created_by_id, badge_id);
