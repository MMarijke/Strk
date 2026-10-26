import { QueryClient } from '@tanstack/react-query';


// staleTime was unset, which means 0: every query was considered stale the
// instant it resolved, so every mount refired it. Moving Dashboard ->
// Social -> Dashboard re-ran the whole Dashboard query set against the
// network, for data that had not changed in the two seconds since.
//
// 30s is chosen against what this data actually is. A habit completion, a
// reaction or a nudge is only ever created by a deliberate action, and
// every one of those paths already calls invalidateQueries on its own
// cache key -- so a user's own writes still appear immediately, and this
// window only affects how often we re-ask for data nobody has changed.
// The thing it cannot show within 30s is a groupmate's completion landing
// while you sit on Social, which is both rare and not something the
// previous behaviour reliably caught either, since it only refetched on
// mount.
//
// refetchOnWindowFocus stays off, as before -- on a mobile PWA that fires
// on every app-switch back, which is frequent and was a real source of
// redundant traffic.
const STALE_TIME_MS = 30_000;

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: STALE_TIME_MS,
		},
	},
});

/**
 * Call this on logout or when a different user authenticates.
 * Wipes every cached query so the next user starts with a clean slate.
 */
export function clearQueryCache() {
  queryClientInstance.clear();
}