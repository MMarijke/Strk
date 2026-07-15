import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
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