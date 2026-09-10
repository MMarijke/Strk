-- Schedules send-weekly-digest to actually run every Monday. It never had
-- a trigger at all -- the function's own header comment says to "set up
-- the schedule via Supabase Dashboard -> Edge Functions -> Cron Jobs",
-- which was apparently never done: pg_cron/pg_net weren't even enabled on
-- this database. Confirmed via direct query against the live project.
--
-- This is what fixes GroupWeeklyReport.jsx's permanent "No data yet" for
-- every groupmate but the viewer -- that stats-computation step (writing
-- last_week_completion_rate / prev_week_completion_rate / etc. onto
-- user_profiles) runs unconditionally for every user with habits,
-- regardless of email_weekly_digest. The Resend email send further down
-- in that same function is currently non-functional (no verified sending
-- domain yet), but that's independent and non-fatal per-user -- it just
-- logs and moves on to the next profile, it doesn't block or skip the
-- stats update. So this migration is worth shipping now even before email
-- is fixed.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The actual secret value is never written here -- it lives in Supabase
-- Vault (vault.create_secret(...), run directly against the project, not
-- committed to any migration) and is looked up by name at execution time.
-- Same "reference by name, value lives outside git" rule this repo
-- already follows for every other secret.
select
  cron.schedule(
    'weekly-digest-monday',
    '0 9 * * 1', -- Monday 09:00 UTC
    $$
    select net.http_post(
      url := 'https://bbcfnislakqitekblgro.supabase.co/functions/v1/send-weekly-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'weekly-digest-monday'
);
