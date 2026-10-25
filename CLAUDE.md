# CLAUDE.md (Strk)

Repo-specific notes. See `../CLAUDE.md` for cross-project conventions.

## CI and deploys — what is automated, and what isn't

Two workflows exist in `.github/workflows/`:

- **`ci.yml`** — runs `npm run lint` and `npm test` on every pull request,
  on Node 22. It deliberately excludes `npm run typecheck`, which has a
  large pre-existing error baseline (see below).
- **`deploy-functions.yml`** — deploys **every** edge function on any push
  to `main` that touches `supabase/functions/**`, then runs
  `supabase functions list` to verify the deploy landed.

Database migrations are applied separately, by Supabase's own GitHub
integration, on push to `main`.

### Edge function deploys ARE automated

This section previously said the opposite — that there was no
`.github/workflows` directory and that every function change needed a
manual `supabase functions deploy`. That stopped being true when
`deploy-functions.yml` was added; its own header says it exists to close
exactly that gap.

The gap was real and is worth remembering: it kept `send-welcome-email`
running vulnerable code (no caller-identity check, no CORS, no rate limit)
in production for two days after the fix was merged to `main`, undetected
until someone checked `supabase functions list` timestamps by hand. The
workflow now does that check itself on every deploy.

Manual deploy is still the fallback if the workflow fails:
`supabase functions deploy <function-name>` — note `--linked` is not a
valid flag on this project's CLI version, and the CLI already targets the
linked project from `supabase/.temp/project-ref`.

### A PR's green checks do NOT validate a migration

**Per-PR Supabase preview branches are currently disabled** on this
project. The `Supabase Preview` check reports `skipped` with
"Creating a new preview branch per PR is disabled. You can re-enable it in
Project Integrations Settings."

So a PR that adds or changes a migration can show all checks green while
its SQL has never been executed anywhere. `ci.yml` only covers JS, and
`lint`/`npm test`/`npm run build` passing says nothing about whether a
migration applies.

This has already bitten: `20261025090002`'s backfill was merged on green
checks and failed on apply with
`permission denied for table user_profiles`. Worse, the fix revealed it
would have matched **zero rows** even with the privilege granted, because
the role it switched to has no `BYPASSRLS` and `auth.uid()` is NULL in a
migration — a silent no-op behind a green tick.

Before merging a migration, either re-enable preview branches in
[project integration settings](https://supabase.com/dashboard/project/bbcfnislakqitekblgro/settings/integrations),
or treat the production apply as the first real test and watch it.

## Migration gotchas this repo has actually hit

- **Writing to a guarded table from a migration.** Several tables have
  column-lockdown triggers whose only escape hatches are
  `auth.role() = 'service_role'` or a specific `current_user`. `SET ROLE`
  to the trusted role is usually the wrong choice: those roles are created
  `noinherit nologin` with narrow grants and **no `BYPASSRLS`**, so RLS
  still applies and `auth.uid()` is NULL. Prefer
  `set local request.jwt.claims = '{"role": "service_role"}'`, which keeps
  the statement running as the migration role (table owner, so RLS does
  not apply) while satisfying the guard. `SET LOCAL` also cannot leak past
  the transaction, unlike disabling a trigger.
- **Changing an RPC's signature or return type.** `CREATE OR REPLACE`
  cannot change a return type, and adding a defaulted parameter creates a
  PostgREST **overload** — a call naming only the original arguments then
  matches both and fails ambiguously. Always `drop function` the old
  signature first.
- **`npm run typecheck` has a large pre-existing baseline** (~478 errors,
  most of them untyped-`forwardRef` `TS2322` noise from the shadcn
  wrappers). Diff the error list against `main` to find genuinely new
  ones; the raw count on its own tells you nothing.

## Local environment notes

- The test suite can crash on worker **startup** with exit code
  `0xC0000409` under memory pressure, reporting far fewer tests than
  exist. That is the machine, not the code — CI runs the full suite on a
  clean runner. Falling back to one file at a time
  (`npx vitest run <file>`) works locally.
- `npm run build` can fail with `memory allocation of N bytes failed` for
  the same reason. Retrying after freeing memory works; capping the heap
  does not help.
