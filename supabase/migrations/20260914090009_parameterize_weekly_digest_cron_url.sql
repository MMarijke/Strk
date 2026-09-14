-- Fix: 20260910090001 hardcoded the production project's URL directly
-- into the cron job body (https://bbcfnislakqitekblgro.supabase.co/...).
-- The x-cron-secret header already correctly avoided this by referencing
-- a Vault secret by name rather than embedding the value -- the URL got
-- missed. Replaying that migration against a different project (staging,
-- a preview branch, local dev) would still schedule a job that calls
-- PRODUCTION's send-weekly-digest every Monday, regardless of which
-- project the migration is actually running against.
--
-- Fix: same pattern as the secret -- store the full function URL in Vault
-- (as 'weekly_digest_function_url') and look it up by name at schedule
-- time, instead of embedding it in git. This migration must be run once
-- per project after the corresponding vault.create_secret(...) call has
-- been made directly against that project (not committed to any
-- migration, same rule as cron_secret) -- e.g.:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/send-weekly-digest',
--     'weekly_digest_function_url'
--   );
--
-- Unschedule-then-reschedule rather than editing the existing job in
-- place: cron.schedule() with an existing jobname overwrites the job
-- definition, but being explicit about the unschedule here documents the
-- intent (replacing a hardcoded-URL job with a parameterized one) rather
-- than leaving it implicit in an upsert.
select cron.unschedule('weekly-digest-monday')
where exists (select 1 from cron.job where jobname = 'weekly-digest-monday');

select
  cron.schedule(
    'weekly-digest-monday',
    '0 9 * * 1', -- Monday 09:00 UTC
    $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_digest_function_url'),
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
