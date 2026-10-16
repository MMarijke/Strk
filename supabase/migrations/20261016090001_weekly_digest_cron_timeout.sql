-- Fix: the weekly-digest cron job (20260914090009) called net.http_post()
-- without an explicit timeout_milliseconds, so it used pg_net's default of
-- 5000ms. The last two Monday runs (2026-10-05, 2026-10-12) both hit that
-- timeout -- confirmed via net._http_response ("Timeout of 5000 ms
-- reached...") -- despite cron.job_run_details reporting "succeeded" for
-- both (that status only reflects the SQL statement that enqueues the
-- async request via pg_net, not whether the request actually completed).
-- user_profiles.last_week_completion_rate hasn't been updated since
-- 2026-09-29, confirming the function never finished either run.
--
-- send-weekly-digest processes every user sequentially (a DB query plus a
-- conditional Resend call per user, no concurrency -- see the function's
-- own fix in this same change for that half of the problem), so 5 seconds
-- is tight even for a handful of users and gets tighter as the user base
-- grows. 60 seconds gives real headroom without masking a genuine hang.
--
-- Same unschedule-then-reschedule pattern as 20260914090009, for the same
-- reason: cron.schedule() with an existing jobname overwrites the
-- definition, but being explicit here documents the intent.
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
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $$
  )
where not exists (
  select 1 from cron.job where jobname = 'weekly-digest-monday'
);
