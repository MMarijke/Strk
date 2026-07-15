import { initializePaddle } from "@paddle/paddle-js";
import { trackEvent } from "@/lib/analytics";

let paddleInstance = null;
let paddlePromise = null;

function getPaddle() {
  if (paddleInstance) return Promise.resolve(paddleInstance);
  if (paddlePromise) return paddlePromise;

  paddlePromise = initializePaddle({
    environment: import.meta.env.VITE_PADDLE_ENV || "sandbox",
    token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
    eventCallback: (event) => {
      // Best-effort client-side signal only — the webhook (paddle-webhook
      // edge function) is the source of truth for actually flipping the
      // user's plan to "pro".
      if (event.name === "checkout.completed") {
        trackEvent("subscription_started");
      }
    },
  }).then((paddle) => {
    paddleInstance = paddle;
    return paddle;
  });

  return paddlePromise;
}

/**
 * Opens the Paddle checkout overlay for the Strk Pro subscription.
 * customData.supabase_user_id is how the webhook matches the resulting
 * Paddle customer/subscription back to this user — Paddle does not
 * enforce email uniqueness, so email alone isn't a safe join key.
 */
export async function openProCheckout({ userId, email }) {
  const priceId = import.meta.env.VITE_PADDLE_PRICE_ID_PRO;
  if (!priceId) {
    console.error("VITE_PADDLE_PRICE_ID_PRO is not configured");
    return;
  }

  const paddle = await getPaddle();
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: { supabase_user_id: userId },
  });
}
