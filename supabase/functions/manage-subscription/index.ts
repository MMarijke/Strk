// Backs the /Subscription page — unlike paddle-webhook, this runs with
// normal JWT verification (it's called by a signed-in user about their own
// subscription, not an external webhook) and always hits Paddle's API live.
// It only reads user_profiles to look up which Paddle subscription/customer
// belongs to the caller — that ID mapping is the one thing still sourced
// from webhook data; everything else (status, price, dates, payment method,
// management_urls) comes fresh from Paddle on every call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PADDLE_API_KEY = Deno.env.get("PADDLE_API_KEY")!;

const PADDLE_API_ENVIRONMENT = Deno.env.get("PADDLE_API_ENVIRONMENT");
if (!PADDLE_API_ENVIRONMENT) {
  // Fail loudly rather than silently guessing sandbox/live — same lesson as
  // the VITE_PADDLE_ENVIRONMENT bug: a wrong guess here doesn't error
  // obviously, it just quietly hits the wrong Paddle account.
  throw new Error('PADDLE_API_ENVIRONMENT is not set. Set it to "sandbox" or "production".');
}
const PADDLE_API_BASE = PADDLE_API_ENVIRONMENT === "production"
  ? "https://api.paddle.com"
  : "https://sandbox-api.paddle.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function paddleFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${PADDLE_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Paddle API error ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let requestBody: { action?: string; priceId?: string };
  try {
    requestBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  // Forward the caller's JWT so this client is scoped to them — the
  // user_profiles RLS policy (owner-only select) does the access control.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("paddle_customer_id, paddle_subscription_id")
    .eq("created_by_id", user.id)
    .single();

  const subscriptionId = profile?.paddle_subscription_id;
  const customerId = profile?.paddle_customer_id;

  if (!subscriptionId) {
    return new Response(JSON.stringify({ error: "No subscription on file" }), { status: 404 });
  }

  try {
    switch (requestBody.action) {
      case "get": {
        const [subscription, paymentMethods] = await Promise.all([
          paddleFetch(`/subscriptions/${subscriptionId}`),
          customerId
            ? paddleFetch(`/customers/${customerId}/payment-methods`).catch(() => [])
            : Promise.resolve([]),
        ]);
        return new Response(JSON.stringify({ subscription, paymentMethods }), { status: 200 });
      }

      case "switch_plan": {
        if (!requestBody.priceId) {
          return new Response(JSON.stringify({ error: "priceId is required" }), { status: 400 });
        }
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}`, {
          method: "PATCH",
          body: JSON.stringify({
            items: [{ price_id: requestBody.priceId, quantity: 1 }],
            proration_billing_mode: "prorated_immediately",
          }),
        });
        return new Response(JSON.stringify({ subscription }), { status: 200 });
      }

      case "cancel": {
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ effective_from: "next_billing_period" }),
        });
        return new Response(JSON.stringify({ subscription }), { status: 200 });
      }

      case "resume": {
        // Undoes a pending cancellation — PATCH only accepts null here
        // ("you may only set to null to remove a scheduled change").
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}`, {
          method: "PATCH",
          body: JSON.stringify({ scheduled_change: null }),
        });
        return new Response(JSON.stringify({ subscription }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
    }
  } catch (err) {
    console.error("manage-subscription error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
});
