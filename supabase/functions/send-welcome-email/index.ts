// Sends the welcome email via Resend once onboarding completes.
// Invoked directly from the client (supabase.functions.invoke).
//
// The recipient is derived from the caller's own verified JWT
// (supabase.auth.getUser(), same pattern as manage-subscription) — never
// trusted from the request body. Previously this took `email` straight
// out of the JSON body with only a truthiness check, so any authenticated
// user (including a fresh free signup) could invoke this with an
// arbitrary target address and send email to anyone via our Resend
// account. There's no legitimate reason for this specific function to
// email someone other than the caller; a "invite a friend" style feature
// would need its own, differently-scoped function, not a loosened
// version of this one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell } from "../_shared/email-template.ts";
import { checkRateLimit, createRateLimiter } from "../_shared/rate-limit.ts";
import { initSentry, captureException } from "../_shared/sentry.ts";
import { requireEnv } from "../_shared/env.ts";

initSentry("send-welcome-email");

// 2/day per user — this only legitimately fires once, right after
// onboarding; the second slot just tolerates a client-side retry if the
// first attempt silently failed (e.g. a flaky network call), without
// leaving room for repeat abuse. Scoped to user id (not IP), via Upstash
// Redis — a separate service from Postgres, so this adds no load to the
// database at all, just one REST round-trip per request.
const rateLimiter = createRateLimiter("send-welcome-email", 2, "1 d");

const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "Strk <hello@strk.app>";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

// Same CORS posture as manage-subscription — this is invoked directly
// from browser JS, so it needs real CORS handling or the browser blocks
// the request before it's sent. `*` is fine since the endpoint is
// JWT-gated regardless of origin.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Forward the caller's JWT so we can ask Supabase Auth who they actually
  // are — this is the only source of truth for the recipient's email.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.email) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const rateLimitResponse = await checkRateLimit(rateLimiter, user.id, CORS_HEADERS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let displayName: string | undefined;
    try {
      const body = await req.json();
      displayName = typeof body?.display_name === "string" ? body.display_name : undefined;
    } catch {
      // No body / non-JSON body is fine — display_name is cosmetic, not required.
    }

    const email = user.email;
    const name = displayName || email.split("@")[0];
    const html = emailShell({
      preheader: "Welcome to Strk. Let's build your first streak.",
      heading: `Welcome, ${name} 🔥`,
      body: `
        <p>Strk helps you build habits that stick, one day at a time.</p>
        <p>Here's how to get the most out of it:</p>
        <ul>
          <li>Add your first habit from the Dashboard</li>
          <li>Check in daily to keep your streak alive</li>
          <li>Join or create a group to stay accountable with friends</li>
        </ul>
      `,
      ctaLabel: "Open Strk",
      ctaUrl: "https://strk.app/Dashboard",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email,
        subject: "Welcome to Strk 🔥",
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("send-welcome-email: Resend API error", res.status, errText);
      return jsonResponse({ error: "Failed to send email" }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("send-welcome-email: unexpected error", err);
    // userId only, never user.email -- see _shared/sentry.ts's scrubbing policy.
    await captureException(err, { userId: user.id });
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});
