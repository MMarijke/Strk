-- Server-side consent logging. Step 1 of the confirmed privacy brief.
--
-- CLAUDE.md requires consent logging, and setAnalyticsConsent writes a
-- single localStorage key and nothing else:
--
--   localStorage.setItem("strk-analytics-consent", value)
--
-- That key is the enforcement gate and has to stay one -- the consent
-- banner is mounted outside the auth gate in App.jsx precisely because
-- PostHog initialises on the public landing page, so the decision must
-- work before there is any user to key a row to. But a localStorage key
-- cannot EVIDENCE consent: it carries no timestamp, no policy version, it
-- does not survive a cache clear, and it never leaves the device. From
-- the operator's side there is no record that consent was ever given; from
-- the user's side, clearing site data silently resets them to "undecided"
-- and the banner asks again, which reads as the opt-out having been
-- ignored.
--
-- So this table is the evidence record, and the localStorage key remains
-- the gate. Per the brief, it covers AUTHENTICATED decisions, reconciled
-- on login. The honest limit, stated rather than hidden: a visitor who
-- never signs up leaves no row -- and there is correspondingly no account
-- to evidence consent for. Minting an anonymous id to close that gap was
-- considered and rejected as self-defeating: a durable tracking
-- identifier for people who have not consented yet.
--
-- ============================================================
-- Append-only by construction
-- ============================================================
--
-- An audit trail that can be rewritten is not one. There are insert and
-- select policies and NO update or delete policy at all, so RLS
-- default-deny makes every existing row immutable -- the same "absence of
-- a policy IS the boundary" pattern accountability_partnerships and
-- accountability_shared_habits use on purpose.
--
-- Note which direction that protects. A user forging a row is harmless:
-- they are the data subject, and a fabricated "I consented" row only
-- weakens their own position. A user DELETING rows would destroy the
-- record of a decision they later dispute, which is what the missing
-- delete policy prevents.
--
-- No column-lockdown trigger is needed, unlike user_profiles or
-- accountability_nudges: every column is set at insert and nothing is
-- permitted to update, so there is no post-insert write path to guard.
--
-- ============================================================
-- user_id only, deliberately no email column
-- ============================================================
--
-- Most tables here carry created_by_id AND created_by, because an email is
-- needed for cross-user matching (remove_group_member deletes by email,
-- get_challenge_member_progress joins on it). Nothing matches a consent
-- row by email, so a second copy of an identifier would be personal data
-- stored for no purpose -- the wrong instinct in the one table whose
-- subject is data protection. It would also mean extending
-- sweep_deleted_user_references, which exists only because email columns
-- cannot cascade.
create table public.analytics_consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  decision text not null check (decision in ('granted', 'denied')),
  -- Which version of PRIVACY_POLICY.md the user was consenting to. Kept in
  -- sync with the document by src/lib/consentLog.test.js, which parses the
  -- "Last updated" line out of PRIVACY_POLICY.md and fails if the constant
  -- the client sends has drifted. A stale version silently records consent
  -- against the wrong document, which is worse than no log at all.
  policy_version text not null,
  created_at timestamptz not null default now()
);

-- The only read this table serves is "my most recent decision", for the
-- idempotent reconciliation on login.
create index analytics_consent_log_user_recent_idx
  on public.analytics_consent_log (user_id, created_at desc);

alter table public.analytics_consent_log enable row level security;

create policy "analytics_consent_log_insert_own"
  on public.analytics_consent_log for insert
  with check (user_id = auth.uid());

create policy "analytics_consent_log_select_own"
  on public.analytics_consent_log for select
  using (user_id = auth.uid());

-- Intentionally no update or delete policy. See the header.

-- ============================================================
-- Retention, per the GDPR/POPIA requirement in CLAUDE.md
-- ============================================================
--
-- RETENTION: a consent row lives as long as the account. user_id cascades
-- off auth.users, so account deletion removes the whole consent history
-- along with everything else the user owns, and
-- 20260811090006_delete_account.sql needs no change -- there is no email
-- column here for its sweep to reach.
--
-- That is a deliberate choice with a real trade-off, and it is the
-- operator's call rather than a design one: cascading destroys the consent
-- evidence at exactly the moment it might be wanted, if a deleted user
-- later disputes what they agreed to. Retaining the row with user_id
-- nulled is the alternative. Cascade is implemented here because it is
-- simplest and privacy-maximal, and because over-retention is its own
-- compliance risk -- but it is a legal question, not a technical one, and
-- changing it later is a one-line migration plus a retention note.
