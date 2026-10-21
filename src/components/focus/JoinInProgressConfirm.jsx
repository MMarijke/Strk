import React from "react";
import { Button } from "@/components/ui/button";

// Shared "session already active" confirm UI -- rendered from
// JoinFocusModal's manual code-entry flow, FocusInviteListener's toast, and
// FocusSessionInviteBanner's one-tap join, so all three stay identical
// instead of three copies drifting apart.
// `error` is optional: FocusInviteListener and FocusSessionInviteBanner both
// swap this component out for their own "already ended" view when a
// confirmed join fails, so they have somewhere to put the news already.
// JoinFocusModal does not -- it stays on this view and had nowhere to render
// the failure, which is the bug this prop exists to close.
export default function JoinInProgressConfirm({ onCancel, onConfirm, loading, error }) {
  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm text-muted-foreground">
        This session is already in progress, so you'll join with less time remaining than
        everyone else. Join anyway?
      </p>
      {error && <p className="text-xs text-destructive-text text-center" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1 rounded-xl h-11 font-semibold" onClick={onConfirm} disabled={loading}>
          {loading ? "Joining…" : "Join Anyway"}
        </Button>
      </div>
    </div>
  );
}
