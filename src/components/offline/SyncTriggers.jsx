import { useEffect } from "react";
import { startSyncTriggers } from "@/lib/offline/sync";

/**
 * Starts and stops the sync triggers. Renders nothing.
 *
 * A component rather than a call in main.jsx, because the triggers must
 * only run for a signed-in user: startSyncTriggers fires a sync
 * immediately, and doing that with no owner recorded is a wasted pass
 * that resolves to `{ skipped: "no-owner" }`.
 *
 * `userId` is a prop rather than read from context here so the effect has
 * an explicit dependency -- mounting this keyed on the user is what makes
 * a session switch tear the old triggers down.
 */
export default function SyncTriggers({ userId }) {
  useEffect(() => {
    if (!userId) return undefined;
    return startSyncTriggers();
  }, [userId]);

  return null;
}
