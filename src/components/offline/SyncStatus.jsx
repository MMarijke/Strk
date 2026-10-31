import React, { useEffect, useState } from "react";
import { CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { getSyncState, onSyncState, syncNow } from "@/lib/offline/sync";
import { retryFailed } from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";

/**
 * Sync state, surfaced only when it is not boring.
 *
 * Pulled forward from phase 4 on purpose: the outbox parks an entry as
 * failed after six attempts, and without somewhere for that to show, a
 * check-in that never reached the server looks exactly like one that did.
 * A silent data-loss signal is worse than an unpolished indicator.
 *
 * Renders nothing in the healthy online case. An always-visible "Synced"
 * badge is chrome that teaches the user to ignore the one state that
 * matters.
 */
export default function SyncStatus({ className }) {
  const [state, setState] = useState(getSyncState);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  );

  useEffect(() => onSyncState(setState), []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const { running, pending, failed } = state;

  // Order matters: a failure outranks everything, then being offline,
  // then work in progress. Showing "Syncing" over a parked failure would
  // imply it is being dealt with.
  if (failed > 0) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2",
          className
        )}
      >
        <AlertTriangle className="w-4 h-4 text-destructive-text shrink-0" aria-hidden="true" />
        <p className="text-xs text-foreground flex-1 min-w-0">
          {failed === 1 ? "1 change didn't save" : `${failed} changes didn't save`}
        </p>
        <button
          type="button"
          onClick={async () => {
            await retryFailed();
            syncNow({ reason: "retry" }).catch(() => {});
          }}
          className="text-xs font-semibold text-primary shrink-0 min-h-11 -my-2 px-1 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!online) {
    return (
      <div role="status" className={cn("flex items-center gap-2 px-1 py-1", className)}>
        <CloudOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">
          {pending > 0
            ? `Offline — ${pending} ${pending === 1 ? "change" : "changes"} will sync later`
            : "Offline — your habits still work"}
        </p>
      </div>
    );
  }

  if (running || pending > 0) {
    return (
      <div role="status" className={cn("flex items-center gap-2 px-1 py-1", className)}>
        <RefreshCw
          className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0", running && "animate-spin")}
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">
          {running ? "Syncing…" : `${pending} ${pending === 1 ? "change" : "changes"} pending`}
        </p>
      </div>
    );
  }

  return null;
}
