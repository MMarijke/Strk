// Centralized Sentry setup for Deno edge functions. Every function routes
// error capture through here rather than calling Sentry.init/captureException
// directly — this is the one place scrubbing is enforced, so a function
// can't accidentally forward a caller's JWT, a full Paddle webhook payload,
// or a raw email address just by capturing an exception the normal way.
//
// Pinned to the same version as the frontend's @sentry/react (10.69.0) —
// both are the same Sentry JS SDK release train, just different platform
// entry points, so keeping them in lockstep avoids API drift between them.
import * as Sentry from "npm:@sentry/deno@10.69.0";

let initialized = false;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "apikey",
  "cookie",
  "x-cron-secret",
  "paddle-signature",
]);

function scrubHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return headers;
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    scrubbed[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return scrubbed;
}

// Backstop over free-text (error messages, extra context) in case an email
// slips in outside the structured fields already stripped below — e.g. an
// error message that happens to interpolate a user's address.
const EMAIL_PATTERN = /[^\s"'<>]+@[^\s"'<>]+\.[^\s"'<>]+/g;

function scrubEmailsInString(value: string): string {
  return value.replace(EMAIL_PATTERN, "[email redacted]");
}

/**
 * Initializes Sentry for one edge function. No-ops if SENTRY_DSN isn't set
 * yet (e.g. before `supabase secrets set SENTRY_DSN=...` has run), so
 * functions keep working normally without it — same pattern as the
 * frontend's initSentry() no-op-if-no-DSN behavior.
 */
export function initSentry(functionName: string) {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    // Exception visibility only for now, not latency — no perf tracing on
    // the backend yet; can be added deliberately later if useful.
    tracesSampleRate: 0,
    // Belt-and-suspenders alongside the manual scrubbing in beforeSend below:
    // never auto-populate user.* fields, never attach request/response bodies.
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    // We don't want or use Sentry's own Deno.serve wrapping or request-data
    // capture at all -- every function calls captureException() manually
    // from its own catch block, so DenoServe's auto-instrumentation buys us
    // nothing. Cutting both integrations removes the capability outright:
    // DenoServe is what captures the real incoming request (headers,
    // forwarded-for IP) into sdkProcessingMetadata in the first place;
    // RequestData is what reads that back out onto the event, including
    // event.user.ip_address (gated by dataCollection.userInfo above per
    // @sentry/core's requestdata.js -- but a live captured event showed
    // Geography/IP anyway, so don't rely on that gate holding; remove the
    // integrations instead of trusting the flag).
    integrations: (defaults) => defaults.filter((i) => i.name !== "DenoServe" && i.name !== "RequestData"),
    // No perf tracing is configured (tracesSampleRate: 0 above), so this
    // buys nothing and is one more surface that could carry request/IP data.
    skipOpenTelemetrySetup: true,
    beforeSend(event) {
      if (event.request) {
        event.request.headers = scrubHeaders(event.request.headers as Record<string, string> | undefined);
        // The actual enforcement point (not just the dataCollection default
        // above) — never forward request/response bodies. Paddle webhook
        // bodies carry full billing/PII data; other functions' bodies can
        // carry emails or other user-supplied text.
        delete event.request.data;
        delete event.request.cookies;
      }
      // Nothing in this codebase calls Sentry.setUser() -- any event.user
      // field (email, ip_address, geo) is SDK-auto-populated, never
      // something we intentionally set. Backend events should never carry
      // user identity at all, so drop it outright as a backstop, in case
      // anything else (present or future) ever populates it -- same
      // reasoning as excluding the integrations above: don't trust a flag,
      // remove the data.
      delete event.user;
      if (event.message) event.message = scrubEmailsInString(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubEmailsInString(ex.value);
      }
      if (event.extra) {
        for (const [key, value] of Object.entries(event.extra)) {
          if (typeof value === "string") event.extra[key] = scrubEmailsInString(value);
        }
      }
      return event;
    },
  });

  Sentry.setTag("function", functionName);
  initialized = true;
}

/**
 * Captures an exception and flushes before the caller returns its response —
 * the edge runtime can freeze/terminate the isolate right after the response
 * is sent, which would otherwise drop the event before it uploads.
 *
 * `context` must only ever carry IDs/event types (e.g. { eventType,
 * subscriptionId, customerId, userId }) — never full objects (webhook
 * payloads, request bodies, user records). Passing only safe fields here is
 * the primary control; beforeSend above is the backstop, not the first line
 * of defense.
 */
export async function captureException(err: unknown, context?: Record<string, unknown>) {
  if (context) Sentry.setContext("edge_function", context);
  Sentry.captureException(err);
  await Sentry.flush(2000);
}
