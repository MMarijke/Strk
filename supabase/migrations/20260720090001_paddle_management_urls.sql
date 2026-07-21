-- Paddle Billing attaches per-subscription self-service links directly to
-- the subscription object (there's no separate "customer portal" concept
-- like Stripe's) — subscription.created/updated payloads include
-- management_urls.update_payment_method and management_urls.cancel.
alter table public.user_profiles add column if not exists paddle_update_payment_method_url text;
alter table public.user_profiles add column if not exists paddle_cancel_url text;
