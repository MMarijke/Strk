import { useQuery } from "@tanstack/react-query";
import { getPaddlePrices } from "@/lib/manageSubscription";
import { PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID } from "@/lib/paddle";

// UpgradeModal mounts this conditionally ({showUpgrade && <UpgradeModal/>}),
// so the query only runs while the modal is actually open. staleTime/gcTime
// are long because catalog prices change essentially never -- the first
// open in a session fetches once; every reopen (same modal or any of the
// other two call sites) reads from cache with no network call.
export function usePaddlePrices() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["paddle-prices", PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID],
    queryFn: () => getPaddlePrices([PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID]),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  // Paddle doesn't guarantee response order matches the request -- look up
  // by id, not array position.
  const byId = Object.fromEntries((data?.prices ?? []).map((p) => [p.id, p]));
  return {
    monthly: byId[PADDLE_MONTHLY_PRICE_ID] ?? null,
    annual: byId[PADDLE_ANNUAL_PRICE_ID] ?? null,
    isLoading,
    isError,
  };
}
