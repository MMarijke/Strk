// Paddle Billing webhook handler — see PADDLE_BILLING.md for the full
// contract this follows (signature format, 5-second ack rule, idempotency).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

// Paddle customers/subscriptions don't carry our user id natively — we stamp
// it into custom_data.supabase_user_id at checkout time (see paddleService.js)
// specifically because Paddle does not enforce email uniqueness across
// customer records, so email alone isn't a safe join key.
async function applySubscriptionEvent(eventType: string, data: Record<string, unknown>) {
  const userId = (data.custom_data as Record<string, unknown> | null)?.supabase_user_id as
    | string
    | undefined;
  if (!userId) {
    console.error(`paddle-webhook: no custom_data.supabase_user_id on ${eventType} (${data.id})`);
    return;
  }

  const status = data.status as string;
  const plan =
    eventType === "subscription.canceled" || eventType === "subscription.paused"
      ? "free"
      : ACTIVE_STATUSES.has(status)
        ? "pro"
        : "free";

  const { error } = await supabase
    .from("user_profiles")
    .update({
      paddle_customer_id: data.customer_id,
      paddle_subscription_id: data.id,
      subscription_status: status,
      plan,
    })
    .eq("created_by_id", userId);

  if (error) throw error;
}

async function processEvent(event: { event_type: string; data: Record<string, unknown> }) {
  if (event.event_type?.startsWith("subscription.")) {
    await applySubscriptionEvent(event.event_type, event.data);
  }
  // customer.* and transaction.* events are logged to paddle_events for the
  // audit trail but don't need further handling — subscription state is the
  // only thing user_profiles.plan cares about.
}

Deno.serve(async (req) => {
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
      return new Response("OK (duplicate)", { status: 200 });
    }
    console.error("paddle-webhook: failed to log event", insertError);
    return new Response("OK (log failed, not retrying)", { status: 200 });
  }

  const processed = processEvent(event)
    .then(() =>
      supabase
        .from("paddle_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("event_id", event.event_id)
    )
    .catch((err) => console.error("paddle-webhook: failed to process event", event.event_id, err));

  // Supabase/Deno Deploy's background-task hook: lets us respond immediately
  // (Paddle's 5-second rule) while finishing the DB update after the fact.
  // @ts-ignore -- EdgeRuntime is a platform global, not in the standard lib types.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(processed);

  return new Response("OK", { status: 200 });
});
