// Shared Upstash Redis rate limiter for edge functions. Redis is a
// separate, external service (Upstash's REST API) — this adds zero load
// to the Supabase Postgres database; the rate-limit check is a single
// HTTP round-trip to Upstash, not a DB query.
import { Ratelimit } from "npm:@upstash/ratelimit@2";
import { Redis } from "npm:@upstash/redis@1";

const redis = new Redis({
  url: Deno.env.get("UPSTASH_REDIS_REST_URL")!,
  token: Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!,
});

/**
 * @param prefix Namespaces keys per-function in Redis (e.g. "manage-subscription")
 *   so different functions' limits never collide even if scoped to the same user id.
 * @param limit Max requests allowed within `window`.
 * @param window Upstash duration string, e.g. "1 h", "1 d".
 */
export function createRateLimiter(prefix: string, limit: number, window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`) {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `strk:${prefix}`,
    analytics: false,
  });
}

/**
 * Checks the limit for `userId` and, if exceeded, returns a ready-to-send
 * 429 Response (including a Retry-After header) — otherwise returns null
 * so the caller knows to proceed.
 */
export async function checkRateLimit(
  limiter: Ratelimit,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const { success, reset } = await limiter.limit(userId);
  if (success) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please wait a bit before trying again.",
      retryAfter: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
