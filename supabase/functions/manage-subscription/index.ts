// Backs the /Subscription page — unlike paddle-webhook, this runs with
// normal JWT verification (it's called by a signed-in user about their own
// subscription, not an external webhook) and always hits Paddle's API live.
// It only reads user_profiles to look up which Paddle subscription/customer
// belongs to the caller — that ID mapping is the one thing still sourced
// from webhook data; everything else (status, price, dates, payment method,
// management_urls) comes fresh from Paddle on every call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimiter } from "../_shared/rate-limit.ts";
import { initSentry, captureException } from "../_shared/sentry.ts";

initSentry("manage-subscription");

// 30/hour per user — generous enough for normal use (the /Subscription
// page calls the "get" action on every load, which can happen several
// times while a user browses Settings) while still shutting down a tight
// loop of switch_plan/cancel/resume calls. Scoped to user id (not IP),
// via Upstash Redis — a separate service from Postgres, so this adds no
// load to the database at all, just one REST round-trip per request.
const rateLimiter = createRateLimiter("manage-subscription", 30, "1 h");
// get_prices is reachable by anyone, signed in or not (see below) -- there's
// no user id to scope a limit to, so this is keyed on IP instead. 60/hour is
// generous for real visitors (react-query already caches this for an hour
// client-side, so a real browser sends at most one of these per session)
// while still bounding how hard an anonymous caller can hit our PADDLE_API_KEY.
const pricesRateLimiter = createRateLimiter("manage-subscription-prices", 60, "1 h");

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

// This is the first function in the project actually invoked cross-origin
// from browser JS (paddle-webhook is called by Paddle's servers, not a
// browser; send-weekly-digest by a cron job) — so unlike those, it needs
// real CORS handling or the browser blocks the request before it's even
// sent, surfacing as a generic "failed to send a request" on the client
// with nothing Paddle-related to show for it. `*` is fine here since the
// endpoint is JWT-gated regardless of origin.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // sentry-trace/baggage: defense in depth, not currently exercised -- the
  // frontend's tracePropagationTargets is scoped to same-origin only, so
  // Sentry shouldn't attach these to this cross-origin call at all. Listed
  // here so a future config change or SDK default shift doesn't silently
  // reintroduce the CORS breakage this caused before that fix (see
  // src/lib/sentry.js).
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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
  // Deliberately not logging the response body -- it can carry billing PII
  // (name/address/card brand/last4/customer email) and this bypasses the
  // redaction _shared/sentry.ts otherwise enforces. Status + path is enough
  // to spot a failing call; captureException below still gets the real
  // error detail for failures specifically, scoped to Sentry.
  console.log(`paddleFetch ${options.method ?? "GET"} ${path} -> ${res.status}`);
  if (!res.ok) {
    throw new Error(`Paddle API error ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.data;
}

// Paddle's own price_id format (see the pattern in their 400 response when
// this doesn't match). Validating here turns a client-side env var mistake
// into an immediately readable error instead of a cryptic Paddle 400.
const PRICE_ID_PATTERN = /^pri_[a-z\d]{26}$/;

// get_prices is reachable by anonymous callers (the public pricing page),
// unlike switch_plan (authenticated, and only ever affects the caller's own
// subscription) -- so it needs more than a format check, or it's an open
// proxy for reading ANY price object in the live Paddle account, including
// ones never meant to be public (archived tiers, test prices, whatever else
// is sitting in the catalog). These aren't secrets -- they're the same
// VITE_PADDLE_*_PRICE_ID values already shipped in the client bundle -- just
// mirrored here as edge secrets so the server has its own copy to check
// against. If unset, PUBLIC_PRICE_IDS is empty and get_prices fails closed
// (every id rejected, 400) rather than silently allowing everything.
const PUBLIC_PRICE_IDS = new Set(
  [Deno.env.get("PADDLE_MONTHLY_PRICE_ID"), Deno.env.get("PADDLE_ANNUAL_PRICE_ID")].filter(
    (id): id is string => Boolean(id)
  )
);

// Supabase's edge runtime sits behind a proxy that sets x-forwarded-for to
// "<client>, <proxy1>, ..." -- the first entry is the original caller. Only
// used to key the anonymous get_prices rate limit below; every other action
// still requires a real signed-in user (see auth.getUser() further down).
function callerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

Deno.serve(async (req) => {
  // Preflight — browsers send this before the real POST because it carries
  // a JSON body plus a custom Authorization header. Must return 200 with
  // the CORS headers, not fall through to the 405 below.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let requestBody: { action?: string; priceId?: string; priceIds?: unknown };
  try {
    requestBody = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // get_prices is a public catalog lookup -- it needs no signed-in user, no
  // user_profiles row, and no stored paddle_subscription_id, so it's handled
  // here, before auth.getUser() below requires a real session. This is what
  // lets the public pricing page show live prices to a logged-out visitor
  // (and, not incidentally, what a Paddle verification reviewer sees too).
  if (requestBody.action === "get_prices") {
    const rateLimitResponse = await checkRateLimit(pricesRateLimiter, callerIp(req), CORS_HEADERS);
    if (rateLimitResponse) return rateLimitResponse;

    const requested = Array.isArray(requestBody.priceIds) ? requestBody.priceIds : [];
    const validIds = requested.filter(
      (id) => typeof id === "string" && PRICE_ID_PATTERN.test(id) && PUBLIC_PRICE_IDS.has(id)
    );
    if (validIds.length === 0) {
      return jsonResponse({ error: "priceIds must be a non-empty array of valid Paddle price ids" }, 400);
    }
    try {
      const prices = await paddleFetch(`/prices?id=${validIds.join(",")}`);
      return jsonResponse({ prices });
    } catch (err) {
      // Detail (raw Paddle error body -- may include internal catalog/
      // account info) stays server-side/Sentry-only; the client gets a
      // generic message.
      console.error("manage-subscription get_prices error:", err);
      await captureException(err, { action: "get_prices" });
      return jsonResponse({ error: "Failed to fetch prices. Please try again." }, 502);
    }
  }

  // Every other action manages an existing subscription and requires a real
  // signed-in user -- forward the caller's JWT so this client is scoped to
  // them; the user_profiles RLS policy (owner-only select) does the access
  // control.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const rateLimitResponse = await checkRateLimit(rateLimiter, user.id, CORS_HEADERS);
  if (rateLimitResponse) return rateLimitResponse;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("paddle_customer_id, paddle_subscription_id")
    .eq("created_by_id", user.id)
    .single();

  const subscriptionId = profile?.paddle_subscription_id;
  const customerId = profile?.paddle_customer_id;

  if (!subscriptionId) {
    return jsonResponse({ error: "No subscription on file" }, 404);
  }

  try {
    switch (requestBody.action) {
      case "get": {
        console.log(`manage-subscription get: subscriptionId=${subscriptionId} customerId=${customerId}`);
        const [subscription, paymentMethodsResult] = await Promise.all([
          paddleFetch(`/subscriptions/${subscriptionId}`),
          customerId
            ? paddleFetch(`/customers/${customerId}/payment-methods`)
                .then((data) => ({ data, error: null }))
                .catch((err) => ({
                  data: [],
                  error: err instanceof Error ? err.message : "Unknown error",
                }))
            : Promise.resolve({ data: [], error: "No paddle_customer_id on file for this user" }),
        ]);
        if (paymentMethodsResult.error) {
          console.error("manage-subscription: payment methods fetch failed:", paymentMethodsResult.error);
        }
        return jsonResponse({
          subscription,
          paymentMethods: paymentMethodsResult.data,
          paymentMethodsError: paymentMethodsResult.error,
          debugCustomerId: customerId,
        });
      }

      case "switch_plan": {
        if (!requestBody.priceId) {
          return jsonResponse({ error: "priceId is required" }, 400);
        }
        if (!PRICE_ID_PATTERN.test(requestBody.priceId)) {
          console.error(`manage-subscription: malformed priceId received: ${JSON.stringify(requestBody.priceId)}`);
          return jsonResponse({
            error: `Received an invalid priceId from the client: ${JSON.stringify(requestBody.priceId)}. ` +
              `Expected Paddle's format (pri_ followed by 26 lowercase alphanumeric characters). ` +
              `Check VITE_PADDLE_MONTHLY_PRICE_ID / VITE_PADDLE_ANNUAL_PRICE_ID in the deployed client build.`,
          }, 400);
        }
        // Same reasoning as get_prices: a well-formatted price id isn't
        // necessarily one of OUR two plans -- without this, an
        // authenticated subscriber could PATCH their own subscription onto
        // any price that exists anywhere in the same Paddle seller account
        // (an archived tier, a test price, anything else in the catalog).
        if (!PUBLIC_PRICE_IDS.has(requestBody.priceId)) {
          console.error(`manage-subscription: priceId not in the public catalog: ${JSON.stringify(requestBody.priceId)}`);
          return jsonResponse({ error: "priceId is not a valid Strk plan." }, 400);
        }
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}`, {
          method: "PATCH",
          body: JSON.stringify({
            items: [{ price_id: requestBody.priceId, quantity: 1 }],
            proration_billing_mode: "prorated_immediately",
          }),
        });
        return jsonResponse({ subscription });
      }

      case "cancel": {
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ effective_from: "next_billing_period" }),
        });
        return jsonResponse({ subscription });
      }

      case "resume": {
        // Undoes a pending cancellation — PATCH only accepts null here
        // ("you may only set to null to remove a scheduled change").
        const subscription = await paddleFetch(`/subscriptions/${subscriptionId}`, {
          method: "PATCH",
          body: JSON.stringify({ scheduled_change: null }),
        });
        return jsonResponse({ subscription });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    // Same reasoning as get_prices above: err.message here is built from
    // paddleFetch's raw Paddle response body, which shouldn't reach the
    // client. Full detail still goes to console/Sentry, scoped to this user.
    console.error("manage-subscription error:", err);
    await captureException(err, { userId: user.id, subscriptionId, customerId, action: requestBody.action });
    return jsonResponse({ error: "Failed to manage your subscription. Please try again." }, 502);
  }
});
