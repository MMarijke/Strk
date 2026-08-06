# CLAUDE.md (Strk)

Repo-specific notes. See `../CLAUDE.md` for cross-project conventions.

## Edge Function Deploys — NOT automated

Pushing to `main` only applies database migrations, via Supabase's
GitHub integration — it never redeploys edge functions. There is no
CI/CD wiring for functions in this repo (no `.github/workflows`
directory exists).

After any change to a file under `supabase/functions/`, you must:

1. Explicitly deploy: `supabase functions deploy <function-name>`
   (`--linked` is not a valid flag on this project's CLI version —
   omit it; the CLI already targets the linked project by default from
   `supabase/.temp/project-ref`)
2. Confirm it actually landed before considering the change live: run
   `supabase functions list` and check that `version` incremented and
   `updated_at` moved past the deploy time, for the specific function
   you changed.

**Why this matters:** this gap already caused `send-welcome-email` to
keep running vulnerable code (no caller-identity check, no CORS, no
rate limit) in production for two days after its fix was merged to
`main` — undetected until explicitly checked via `supabase functions
list` timestamps.
