// Deletes the caller's own account entirely. The Admin API call is the
// one step that requires service_role and can't run client-side -- every
// app table's created_by_id already cascades off auth.users, so that
// call alone correctly wipes every row the user OWNS. Two things it
// can't reach on its own, both handled here first, before the point of
// no return:
//   1. Any active Paddle subscription -- our own copy of
//      paddle_subscription_id cascade-deletes with the account, but the
//      real Paddle-side subscription is unaffected and keeps renewing
//      with no app account left to manage it, unless we cancel it
//      ourselves via Paddle's API.
//   2. The caller's email sitting in plain text/array columns on rows
//      OWNED BY SOMEONE ELSE (groups.member_emails,
//      group_challenges.member_emails, focus_sessions.participant_emails,
//      reactions.recipient_email, challenge_notifications.recipient_email/
//      started_by_email) -- no FK cascade can ever reach these, since
//      they're not relationships Postgres knows about, just copied email
//      strings. Delegated to sweep_deleted_user_references() (see
//      20260811090006), called via the CALLER's own JWT so auth.uid()/
//      auth.jwt() inside it correctly resolve to them, not service_role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { initSentry, captureException } from "../_shared/sentry.ts";

initSentry("delete-account");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PADDLE_API_KEY = Deno.env.get("PADDLE_API_KEY")!;
const PADDLE_API_ENVIRONMENT = Deno.env.get("PADDLE_API_ENVIRONMENT");
if (!PADDLE_API_ENVIRONMENT) {
  throw new Error('PADDLE_API_ENVIRONMENT is not set. Set it to "sandbox" or "production".');
}
const PADDLE_API_BASE = PADDLE_API_ENVIRONMENT === "production"
  ? "https://api.paddle.com"
  : "https://sandbox-api.paddle.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Cancels immediately, not next_billing_period -- unlike the in-app
// "cancel my plan" flow (manage-subscription), there's no account left
// afterward to keep granting access-until-period-end against, so keeping
// the subscription running any longer than necessary would only mean
// charging someone for a service they can no longer reach or manage.
async function cancelPaddleSubscription(subscriptionId: string) {
  const res = await fetch(`${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ effective_from: "immediately" }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Paddle cancel error ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Forward the caller's own JWT to resolve who they actually are -- never
  // trust a client-supplied user id for a destructive action like this.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Cancel any active Paddle subscription first, while
    // paddle_subscription_id is still readable. Non-fatal on failure --
    // logged to Sentry, but a transient Paddle API issue shouldn't block
    // someone from deleting their account outright.
    const { data: profile } = await callerClient
      .from("user_profiles")
      .select("paddle_subscription_id")
      .eq("created_by_id", user.id)
      .maybeSingle();

    if (profile?.paddle_subscription_id) {
      try {
        await cancelPaddleSubscription(profile.paddle_subscription_id);
      } catch (err) {
        console.error("delete-account: failed to cancel Paddle subscription", user.id, err);
        await captureException(err, { userId: user.id, where: "paddle-cancel" });
      }
    }

    // 2. Sweep the caller's email out of every other user's rows --
    // called via the caller's own client so auth.uid()/auth.jwt() inside
    // the function resolve to them, letting sweep_deleted_user_references()
    // scope itself correctly with no parameters to abuse.
    const { error: sweepError } = await callerClient.rpc("sweep_deleted_user_references");
    if (sweepError) {
      console.error("delete-account: sweep failed", user.id, sweepError);
      await captureException(new Error(`delete-account sweep failed: ${sweepError.message}`), { userId: user.id });
      return jsonResponse({ error: "Failed to clean up account references. Please try again." }, 500);
    }

    // 3. The point of no return -- everything the user owns cascades
    // automatically from here.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("delete-account: admin delete failed", user.id, deleteError);
      await captureException(new Error(`delete-account admin delete failed: ${deleteError.message}`), { userId: user.id });
      return jsonResponse({ error: "Failed to delete account. Please try again or contact support." }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("delete-account: unexpected error", user.id, err);
    await captureException(err, { userId: user.id });
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});
