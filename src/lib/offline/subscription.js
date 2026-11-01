import { USER_PROFILES } from "./tables";
import { getSyncedAt } from "./db";
import { localFilter } from "./localStore";

/**
 * How far to trust a cached subscription plan.
 *
 * Billing is the one piece of state where offline caching cuts both
 * ways. Refusing to trust it at all would downgrade a paying customer
 * the moment their train enters a tunnel, which is indefensible.
 * Trusting it forever would hand out Pro to a lapsed subscriber on a
 * device that simply never reconnects, and `plan` is the column the
 * whole paid tier hangs off.
 *
 * Seven days is the compromise: longer than any plausible offline
 * stretch for someone actually using a habit tracker daily, short
 * enough that an abandoned device stops being a free Pro licence. It is
 * deliberately generous, because the failure mode it guards against
 * (someone keeps Pro features for a week after cancelling, on one
 * device, while offline) is far cheaper than the one it avoids
 * (a subscriber loses what they paid for on a flight).
 */
export const SUBSCRIPTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a cached plan may still be honoured.
 *
 * Pure, and separated from the hook, because this is the rule that
 * decides whether somebody gets what they paid for -- it should be
 * readable and testable without a React renderer.
 *
 * `syncedAt` null means the mirror has never completed a pull, so there
 * is nothing to date the plan by and it cannot be honoured. Fail closed:
 * no cached evidence is not evidence of Pro.
 */
export function resolveCachedPlan({ plan, syncedAt, now = Date.now() }) {
  const paid = plan === "pro";
  if (!paid) return { isPro: false, expired: false, ageMs: null };

  if (!syncedAt) return { isPro: false, expired: true, ageMs: null };

  const at = Date.parse(syncedAt);
  // An unparseable stamp is treated as no stamp rather than as "now".
  if (Number.isNaN(at)) return { isPro: false, expired: true, ageMs: null };

  // A stamp in the future (clock skew, or a device whose clock moved
  // backwards) is clamped to fresh rather than treated as ancient: the
  // user's plan should not lapse because their clock is wrong.
  const ageMs = Math.max(0, now - at);
  const expired = ageMs > SUBSCRIPTION_MAX_AGE_MS;

  return { isPro: !expired, expired, ageMs };
}

/**
 * The plan held in the mirror, and how old the mirror is.
 *
 * Reads the local store directly rather than going back through the
 * entities adapter, which would try the network again -- this is the
 * path taken precisely because the network just failed or is known to be
 * gone.
 */
export async function getCachedSubscription(email) {
  const [rows, syncedAt] = await Promise.all([
    localFilter(USER_PROFILES, { created_by: email }),
    getSyncedAt(USER_PROFILES),
  ]);
  return { plan: rows[0]?.plan ?? null, syncedAt };
}
