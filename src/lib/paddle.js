import { initializePaddle } from '@paddle/paddle-js';
import { trackEvent } from '@/lib/analytics';

let paddleInstance = null;

export async function getPaddle() {
  if (paddleInstance) return paddleInstance;
  paddleInstance = await initializePaddle({
    environment: import.meta.env.VITE_PADDLE_ENVIRONMENT || 'sandbox',
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
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email: userEmail },
    // Subscription/transaction webhook payloads carry customer_id but not
    // reliably the customer's email — custom_data set here does propagate
    // to those events, so the webhook uses it to resolve the Strk user.
    customData: { email: userEmail },
  });
}

export const PADDLE_MONTHLY_PRICE_ID =
  import.meta.env.VITE_PADDLE_MONTHLY_PRICE_ID;
export const PADDLE_ANNUAL_PRICE_ID =
  import.meta.env.VITE_PADDLE_ANNUAL_PRICE_ID;
