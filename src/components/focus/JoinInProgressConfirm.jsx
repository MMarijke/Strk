import React from "react";
import { Button } from "@/components/ui/button";

// Shared "session already active" confirm UI -- rendered from
// JoinFocusModal's manual code-entry flow, FocusInviteListener's toast, and
// FocusSessionInviteBanner's one-tap join, so all three stay identical
// instead of three copies drifting apart.
export default function JoinInProgressConfirm({ onCancel, onConfirm, loading }) {
  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm text-muted-foreground">
        This session is already in progress, so you'll join with less time remaining than
        everyone else. Join anyway?
      </p>
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
