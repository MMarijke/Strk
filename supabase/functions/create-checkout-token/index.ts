// Mints the signed, short-lived token that src/lib/paddle.js stamps into
// Paddle Checkout's custom_data so paddle-webhook can trust
// custom_data.checkoutToken as proof of who actually opened this checkout.
// See _shared/checkout-token.ts for why that's necessary -- custom_data
// itself is fully client-controlled and was previously spoofable via a raw
// client-supplied email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimiter } from "../_shared/rate-limit.ts";
import { initSentry, captureException } from "../_shared/sentry.ts";
import { signCheckoutToken } from "../_shared/checkout-token.ts";

initSentry("create-checkout-token");

const CHECKOUT_TOKEN_SECRET = Deno.env.get("PADDLE_CHECKOUT_TOKEN_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Same reasoning as manage-subscription: called directly from browser JS,
// cross-origin, and JWT-gated regardless of origin, so `*` is fine here.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Generous but bounded -- a real user opens checkout at most a handful of
// times per session; this just stops a tight loop from spamming Sentry.
const rateLimiter = createRateLimiter("create-checkout-token", 20, "1 h");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const rateLimitResponse = await checkRateLimit(rateLimiter, user.id, CORS_HEADERS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const token = signCheckoutToken(user.id, CHECKOUT_TOKEN_SECRET);
    return jsonResponse({ token });
  } catch (err) {
    console.error("create-checkout-token error:", err);
    await captureException(err, { userId: user.id });
    return jsonResponse({ error: "Failed to create checkout token" }, 500);
  }
});
