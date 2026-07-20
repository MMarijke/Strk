-- Tracks which Paddle price (monthly vs annual) a user is subscribed to.
--
-- Not re-adding paddle_customer_id / paddle_subscription_id / subscription_status
-- here — they already exist from 20260715090001_paddle_billing.sql. A separate
-- "paddle_subscription_status" column was requested alongside this but was
-- skipped: subscription_status already holds exactly that value, and a second
-- column with the same meaning would just invite the two to drift out of sync.
alter table public.user_profiles add column if not exists paddle_price_id text;
