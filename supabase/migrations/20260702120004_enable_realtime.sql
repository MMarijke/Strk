-- Replaces base44.entities.ChallengeNotification.subscribe() (Social.jsx) with
-- Postgres change streaming over Supabase Realtime.

alter publication supabase_realtime add table public.challenge_notifications;
