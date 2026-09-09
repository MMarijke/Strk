-- Paddle migration audit follow-up to 20260727090001: that migration's
-- protect_user_profiles_billing_fields() trigger covers plan,
-- subscription_status, paddle_subscription_id, paddle_customer_id, and
-- paddle_price_id, but missed the two columns added a week earlier in
-- 20260720090001_paddle_management_urls.sql --
-- paddle_update_payment_method_url and paddle_cancel_url. Same webhook-only
-- invariant applies to these (paddle-webhook is the only legitimate writer),
-- so a plain client update() could currently overwrite them directly.
--
-- Checked actual impact before treating this as urgent: neither column is
-- read anywhere in the client anymore. Subscription.jsx and Settings.jsx
-- both fetch management_urls live from Paddle via manage-subscription's
-- "get" action instead of trusting the cached columns (see the comment at
-- Settings.jsx's "Manage Subscription" link). So today this is unused
-- webhook-write-only state, not an active privilege-escalation path -- but
-- it's still billing data that shouldn't be client-writable, and closing it
-- now costs nothing and matches the audit's stated invariant.
create or replace function public.protect_user_profiles_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.plan is distinct from old.plan
    or new.subscription_status is distinct from old.subscription_status
    or new.paddle_subscription_id is distinct from old.paddle_subscription_id
    or new.paddle_customer_id is distinct from old.paddle_customer_id
    or new.paddle_price_id is distinct from old.paddle_price_id
    or new.paddle_update_payment_method_url is distinct from old.paddle_update_payment_method_url
    or new.paddle_cancel_url is distinct from old.paddle_cancel_url
  ) and auth.role() is distinct from 'service_role' then
    raise exception 'plan, subscription_status, and paddle_* fields can only be modified by service_role (the Paddle webhook)';
  end if;
  return new;
end;
$$;
