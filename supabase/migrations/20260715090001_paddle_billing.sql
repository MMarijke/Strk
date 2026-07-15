-- Paddle Billing integration (Merchant of Record — see PADDLE_BILLING.md).
-- user_profiles is this app's per-user billing record; Paddle customer IDs
-- (ctm_...) are matched back to it via custom_data.supabase_user_id at
-- checkout time, not by email (Paddle does not enforce email uniqueness).

alter table public.user_profiles add column paddle_customer_id text unique;
alter table public.user_profiles add column paddle_subscription_id text;
alter table public.user_profiles add column subscription_status text;

-- Raw webhook event log, for idempotency and auditability. Written to
-- immediately on receipt, before any processing (see paddle-webhook edge
-- function) — service-role only, no end-user access.
create table public.paddle_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,       -- Paddle's evt_ id, for idempotency
  event_type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.paddle_events enable row level security;
-- No policies: only the service-role key (used by the webhook edge function)
-- can read/write this table. Regular users get zero access by default.
