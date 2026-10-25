// Paddle Billing webhook handler — see PADDLE_BILLING.md for the full
// contract this follows (signature format, 5-second ack rule, idempotency).
//
// Matching note: Paddle Billing doesn't actually emit a "subscription.activated"
// event — activation is represented by subscription.created/updated events
// carrying status: "active" (or "trialing"). We treat those as the
// "activated" case and subscription.canceled/paused as deactivation.
//
// We resolve the Strk user in two steps, neither of which trusts anything
// client-controlled:
//   1. Once we've seen a customer before, join on Paddle's own
//      customer_id (stored on user_profiles by a prior event) — this value
//      is entirely Paddle-assigned, never client input.
//   2. On a user's very first purchase we have no stored customer_id yet.
//      For that case only, custom_data.checkoutToken carries a short-lived,
//      HMAC-signed token minted by create-checkout-token for the
//      *authenticated* caller — see _shared/checkout-token.ts. This
//      replaces an earlier version that resolved users by a raw,
//      client-supplied custom_data.email, which let anyone bind a real
//      purchase to an arbitrary victim's account. Do not reintroduce an
//      email-based fallback here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { initSentry, captureException } from "../_shared/sentry.ts";
import { isFromPaddle } from "../_shared/paddle-ip-allowlist.ts";
import { verifyCheckoutToken } from "../_shared/checkout-token.ts";
import { requireEnv } from "../_shared/env.ts";

initSentry("paddle-webhook");

const WEBHOOK_SECRET = requireEnv("PADDLE_WEBHOOK_SECRET");
const CHECKOUT_TOKEN_SECRET = requireEnv("PADDLE_CHECKOUT_TOKEN_SECRET");
const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

function verifySignature(rawBody: string, header: string): boolean {
  // header format: "ts=<timestamp>;h1=<hash>"
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=")));
  if (!parts.ts || !parts.h1) return false;

  const signedPayload = `${parts.ts}:${rawBody}`;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(signedPayload).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(parts.h1);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// Resolves the Strk user id for a Paddle event without trusting anything
// client-controlled — see the file header for the two-step strategy.
async function resolveUserId(data: Record<string, unknown>): Promise<string | undefined> {
  const customerId = data.customer_id as string | undefined;
  if (customerId) {
    const { data: byCustomer } = await supabase
      .from("user_profiles")
      .select("created_by_id")
      .eq("paddle_customer_id", customerId)
      .maybeSingle();
    if (byCustomer) return byCustomer.created_by_id as string;
  }

  const customData = data.custom_data as Record<string, unknown> | null;
  const token = customData?.checkoutToken as string | undefined;
  if (token) {
    const uid = verifyCheckoutToken(token, CHECKOUT_TOKEN_SECRET);
    if (uid) return uid;
  }

  return undefined;
}

function firstItemPriceId(data: Record<string, unknown>): string | null {
  const items = data.items as Array<Record<string, unknown>> | undefined;
  const price = items?.[0]?.price as Record<string, unknown> | undefined;
  return (price?.id as string | undefined) ?? null;
}

// Paddle Billing has no separate "customer portal" — each subscription
// carries its own self-service links directly in management_urls.
function managementUrls(data: Record<string, unknown>): {
  updatePaymentMethodUrl: string | null;
  cancelUrl: string | null;
} {
  const urls = data.management_urls as Record<string, unknown> | null;
  return {
    updatePaymentMethodUrl: (urls?.update_payment_method as string | undefined) ?? null,
    cancelUrl: (urls?.cancel as string | undefined) ?? null,
  };
}

async function applySubscriptionEvent(eventType: string, data: Record<string, unknown>) {
  const userId = await resolveUserId(data);
  if (!userId) {
    console.error(`paddle-webhook: no resolvable user for ${eventType} (${data.id})`);
    return;
  }

  const status = data.status as string;
  const plan =
    eventType === "subscription.canceled" || eventType === "subscription.paused"
      ? "free"
      : ACTIVE_STATUSES.has(status)
        ? "pro"
        : "free";
  const { updatePaymentMethodUrl, cancelUrl } = managementUrls(data);

  const { error } = await supabase
    .from("user_profiles")
    .update({
      paddle_customer_id: data.customer_id,
      paddle_subscription_id: data.id,
      paddle_price_id: firstItemPriceId(data),
      paddle_update_payment_method_url: updatePaymentMethodUrl,
      paddle_cancel_url: cancelUrl,
      subscription_status: status,
      plan,
    })
    .eq("created_by_id", userId);

  if (error) throw error;
}

// Fires on every successful charge (initial + renewals), ahead of or
// alongside subscription.created/updated — a redundant fast path so a
// completed payment grants access even if the subscription event is
// delayed, without overriding subscription.* as the authoritative status.
async function applyTransactionCompleted(data: Record<string, unknown>) {
  const userId = await resolveUserId(data);
  if (!userId) {
    console.error(`paddle-webhook: no resolvable user for transaction.completed (${data.id})`);
    return;
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({
      plan: "pro",
      paddle_customer_id: data.customer_id,
      paddle_subscription_id: (data.subscription_id as string | undefined) ?? null,
      paddle_price_id: firstItemPriceId(data),
    })
    .eq("created_by_id", userId);

  if (error) throw error;
}

// How long a logged-but-unprocessed row has to sit before a duplicate
// delivery is allowed to pick it up. Short enough to recover quickly, long
// enough that it cannot race an attempt that is still in flight.
const STUCK_AFTER_MS = 2 * 60 * 1000;

/**
 * processEvent with bounded retries.
 *
 * Needed because of how the ack and the processing interact. We return 200
 * to Paddle BEFORE processing (their 5-second rule), so Paddle will never
 * retry -- and if it did, the unique constraint on event_id used to route
 * it straight to the "duplicate" branch, which returned without processing.
 * The two safeguards combined to guarantee that a single transient failure
 * left the row `processed = false` forever, with nothing on any schedule
 * looking at it. A paid upgrade or a cancellation could be lost outright.
 *
 * A transient database or network blip is the realistic cause, so retrying
 * in place fixes the common case without new infrastructure.
 */
async function processEventWithRetry(
  event: { event_type: string; data: Record<string, unknown> },
  attempts = 3
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await processEvent(event);
      return;
    } catch (err) {
      lastErr = err;
      // 400ms, 1200ms -- short enough to stay inside the background task's
      // budget, long enough to clear a momentary blip.
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * Math.pow(3, i)));
    }
  }
  throw lastErr;
}

async function processEvent(event: { event_type: string; data: Record<string, unknown> }) {
  if (event.event_type === "transaction.completed") {
    await applyTransactionCompleted(event.data);
  } else if (event.event_type?.startsWith("subscription.")) {
    await applySubscriptionEvent(event.event_type, event.data);
  }
  // customer.* events are logged to paddle_events for the audit trail but
  // don't need further handling.
}

/**
 * Process an event, mark it processed, and report a final failure loudly.
 *
 * Shared by the first delivery and the stuck-row re-processing branch so
 * there is one copy of "what happens after the row is logged".
 */
function runProcessing(event: { event_id: string; event_type: string; data: Record<string, unknown> }) {
  return processEventWithRetry(event)
    .then(() =>
      supabase
        .from("paddle_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("event_id", event.event_id)
    )
    .catch(async (err) => {
      // Says what state this leaves behind, because the row is the only
      // record that anything is wrong and nothing is scheduled to look at
      // it. `select * from paddle_events where not processed` is the queue.
      console.error(
        "paddle-webhook: event remains UNPROCESSED after retries and needs reconciliation",
        event.event_id,
        err
      );
      await captureException(err, {
        eventType: event.event_type,
        eventId: event.event_id,
        objectId: (event.data as Record<string, unknown> | undefined)?.id,
        unprocessed: true,
      });
    });
}

Deno.serve(async (req) => {
  try {
    // Second, independent layer on top of the signature check below --
    // rejects anything not sent from one of Paddle's published IPs. See
    // _shared/paddle-ip-allowlist.ts for why this fails open rather than
    // closed when the caller IP or Paddle's IP list can't be resolved.
    if (!(await isFromPaddle(req))) {
      console.error("paddle-webhook: rejected request from non-Paddle IP", req.headers.get("x-forwarded-for"));
      return new Response("Forbidden", { status: 403 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("paddle-signature") ?? "";

    if (!verifySignature(rawBody, signature)) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(rawBody);

    // Write first, ack fast, process after — see PADDLE_BILLING.md's 5-second
    // rule. Idempotency is enforced by the unique constraint on event_id.
    const { error: insertError } = await supabase
      .from("paddle_events")
      .insert({ event_id: event.event_id, event_type: event.event_type, payload: event });

    if (insertError) {
      if (insertError.code === "23505") {
        // A duplicate is normally nothing to do -- but it is also the only
        // second chance an event ever gets. If the first delivery logged
        // the row and then failed to process it, returning OK here is what
        // made the loss permanent.
        //
        // Re-processed only once the row has sat unprocessed for
        // STUCK_AFTER_MS, so this cannot race an attempt still running in
        // the original request's background task. Applying a subscription
        // event twice is safe regardless: applySubscriptionEvent and
        // applyTransactionCompleted both write absolute values from the
        // payload rather than incrementing anything.
        const { data: existing } = await supabase
          .from("paddle_events")
          .select("processed, received_at")
          .eq("event_id", event.event_id)
          .maybeSingle();

        const stuck = existing
          && existing.processed === false
          && Date.now() - new Date(existing.received_at).getTime() > STUCK_AFTER_MS;

        if (!stuck) {
          return new Response("OK (duplicate)", { status: 200 });
        }

        console.warn("paddle-webhook: re-processing a stuck unprocessed event", event.event_id);
        const retried = runProcessing(event);
        // @ts-ignore -- EdgeRuntime is a platform global, not in the standard lib types.
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(retried);
        return new Response("OK (reprocessing)", { status: 200 });
      }
      console.error("paddle-webhook: failed to log event", insertError);
      // Backgrounded like the processing capture below — don't hold up
      // Paddle's 5-second ack budget on the Sentry flush.
      const logFailureCaptured = captureException(new Error(`paddle-webhook: failed to log event: ${insertError.message}`), {
        eventType: event.event_type,
        eventId: event.event_id,
      });
      // @ts-ignore -- EdgeRuntime is a platform global, not in the standard lib types.
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(logFailureCaptured);
      return new Response("OK (log failed, not retrying)", { status: 200 });
    }

    const processed = runProcessing(event);

    // Supabase/Deno Deploy's background-task hook: lets us respond immediately
    // (Paddle's 5-second rule) while finishing the DB update after the fact.
    // @ts-ignore -- EdgeRuntime is a platform global, not in the standard lib types.
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(processed);

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("paddle-webhook: unhandled error", err);
    await captureException(err, { where: "top-level handler" });
    return new Response("Internal error", { status: 500 });
  }
});
