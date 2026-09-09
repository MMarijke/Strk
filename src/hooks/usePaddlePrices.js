import { useQuery } from "@tanstack/react-query";
import { getPaddlePrices } from "@/lib/manageSubscription";
import { PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID } from "@/lib/paddle";

// React Query's isLoading has no built-in ceiling -- if the underlying
// request hangs (rather than cleanly erroring), isLoading stays true
// forever and PriceLine's skeleton spins indefinitely on the one card a
// paying-intent visitor is actually staring at. Racing against a timeout
// converts a hang into a real rejection, which PriceLine already handles
// (formatPrice(null) falls back to "Sign in to see pricing") -- no
// rendering logic needs to change, the hang just needs to become an error.
const PRICE_FETCH_TIMEOUT_MS = 6000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Price fetch timed out")), ms)),
  ]);
}

// UpgradeModal mounts this conditionally ({showUpgrade && <UpgradeModal/>}),
// so the query only runs while the modal is actually open. staleTime/gcTime
// are long because catalog prices change essentially never -- the first
// open in a session fetches once; every reopen (same modal or any of the
// other two call sites) reads from cache with no network call.
export function usePaddlePrices() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["paddle-prices", PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID],
    queryFn: () => withTimeout(getPaddlePrices([PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID]), PRICE_FETCH_TIMEOUT_MS),
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
