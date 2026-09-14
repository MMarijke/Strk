import { initializePaddle } from '@paddle/paddle-js';
import { trackEvent } from '@/lib/analytics';
import { supabase } from '@/api/supabaseClient';

let paddleInstance = null;

export async function getPaddle() {
  if (paddleInstance) return paddleInstance;

  const environment = import.meta.env.VITE_PADDLE_ENVIRONMENT;
  if (!environment) {
    // No fallback on purpose — a missing env var silently defaulting to
    // "sandbox" is exactly the kind of bug that stays invisible until a
    // real customer hits it in production.
    throw new Error(
      'VITE_PADDLE_ENVIRONMENT is not set. Set it explicitly to "sandbox" or "production" for this deploy.'
    );
  }

  paddleInstance = await initializePaddle({
    environment,
    token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
    eventCallback: (event) => {
      // Best-effort client-side signal only — the webhook (paddle-webhook
      // edge function) is the source of truth for actually flipping the
      // user's plan to "pro".
      if (event.name === 'checkout.completed') {
        trackEvent('subscription_started');
      }
    },
  });
  return paddleInstance;
}

export async function openCheckout(priceId, userEmail) {
  const paddle = await getPaddle();

  // custom_data on a Paddle Checkout is fully client-controlled — anyone
  // can call the Paddle.js SDK directly (bypassing this function) with
  // arbitrary custom_data. So paddle-webhook no longer trusts a raw email
  // here as the join key back to a Strk user; instead we ask a
  // JWT-authenticated edge function to mint a short-lived, signed token
  // proving who's actually signed in, and stamp that instead. See
  // supabase/functions/_shared/checkout-token.ts for the verification side.
  const { data, error } = await supabase.functions.invoke('create-checkout-token');
  if (error || !data?.token) {
    throw new Error('Could not start checkout — please try again.');
  }

  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    // customer.email only prefills Paddle's own checkout UI — it plays no
    // role in resolving the Strk account, so it doesn't need to be trusted.
    customer: { email: userEmail },
    customData: { checkoutToken: data.token },
  });
}

export const PADDLE_MONTHLY_PRICE_ID =
  import.meta.env.VITE_PADDLE_MONTHLY_PRICE_ID;
export const PADDLE_ANNUAL_PRICE_ID =
  import.meta.env.VITE_PADDLE_ANNUAL_PRICE_ID;
