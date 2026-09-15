import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Sibling of FreezeConfirmModal.jsx (self-freeze) -- deliberately uses the
// --frozen token instead of repeating that component's own hardcoded
// blue-500/600, which is a known, separately-tracked cleanup item.
export default function FreezeAssistConfirmModal({ open, onOpenChange, targetName, habitName, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            ❄️ Save {targetName}'s streak?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Spend one of your unlimited Pro freezes to protect{" "}
          <span className="font-semibold text-foreground">{targetName}</span>'s streak on{" "}
          <span className="font-semibold text-foreground">{habitName}</span>. They'll be notified
          it was you -- this doesn't touch their own monthly freeze allowance.
        </p>
        <p className="text-sm font-medium" style={{ color: "hsl(var(--frozen))" }}>
          ✨ Pro: free to give, unlimited to use
        </p>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => { onConfirm(); onOpenChange(false); }}
            className="text-white hover:opacity-90"
            style={{ backgroundColor: "hsl(var(--frozen))" }}
          >
            ❄️ Save Streak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
