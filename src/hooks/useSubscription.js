import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { UserProfile } from "@/api/entities";
import { getCachedSubscription, resolveCachedPlan } from "@/lib/offline/subscription";

/**
 * The viewer's paid status, including with no network.
 *
 * Two things this has to get right that a plain read does not:
 *
 *   - Online, the SERVER is authoritative. `plan` is flipped by the
 *     Paddle webhook, so the mirror can be a pull behind, and a customer
 *     who has just checked out must not still be told they are on free.
 *     Hence `fresh: true`.
 *
 *   - Otherwise the cached plan is honoured, but not forever. See
 *     SUBSCRIPTION_MAX_AGE_MS for why seven days and which way that
 *     trade-off deliberately leans.
 *
 * The two cases are kept apart deliberately. A verified answer is used
 * as-is; only a cached one goes through the age rule. Collapsing them --
 * dating a verified answer by the mirror's last pull -- would downgrade a
 * paying user on a device whose profile mirror had not synced yet, which
 * is the exact failure this is meant to prevent.
 */
export function useSubscription() {
  const { user } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["subscription", user?.email],
    queryFn: async () => {
      const email = user?.email;
      if (!email) return { plan: null, syncedAt: null, verified: false };

      const online = typeof navigator === "undefined" || navigator.onLine !== false;
      if (online) {
        try {
          const profiles = await UserProfile.filter({ created_by: email }, undefined, {
            fresh: true,
          });
          return { plan: profiles[0]?.plan ?? null, syncedAt: null, verified: true };
        } catch (err) {
          // Online but the read failed. Falling through to the cache,
          // rather than letting this reject: a rejected query leaves
          // isPro false, which charges a paying customer for a flaky
          // connection by taking their features away.
          console.error("subscription: live read failed, falling back to cache", err);
        }
      }

      const cached = await getCachedSubscription(email);
      return { ...cached, verified: false };
    },
    enabled: !!user?.email,
  });

  const verified = data?.verified ?? false;
  const cached = resolveCachedPlan({ plan: data?.plan ?? null, syncedAt: data?.syncedAt ?? null });

  return {
    isPro: verified ? data?.plan === "pro" : cached.isPro,
    isLoading,
    refetch,
    // True only when a cached `pro` was refused for being too old. Lets a
    // surface explain why a paid feature went away rather than leaving
    // the user to find out by tapping it.
    isSubscriptionExpired: !verified && cached.expired,
  };
}
