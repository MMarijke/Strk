-- Server-side opt-in flag for the weekly digest email, mirrored from the
-- "Monday Notification" toggle in Settings so the send-weekly-digest cron
-- function knows who to email regardless of local device/browser state.
alter table public.user_profiles add column email_weekly_digest boolean not null default true;
