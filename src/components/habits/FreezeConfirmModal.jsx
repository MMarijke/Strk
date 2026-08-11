import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FREE_FREEZES_PER_MONTH } from "@/lib/freezeService";

export default function FreezeConfirmModal({ open, onOpenChange, habit, freezesRemaining, isPro, onConfirm }) {
  const noFreezesLeft = !isPro && freezesRemaining <= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            ❄️ Use Streak Freeze?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Protect your streak for{" "}
          <span className="font-semibold text-foreground">{habit?.name}</span>? Yesterday will be
          marked as frozen, so your streak stays alive!
        </p>
        {isPro ? (
          <p className="text-sm text-blue-500 font-medium">✨ Pro: unlimited freezes</p>
        ) : noFreezesLeft ? (
          <div className="rounded-lg bg-muted/60 p-3 space-y-1">
            <p className="text-sm font-semibold text-destructive">No freezes left this month</p>
            <p className="text-xs text-muted-foreground">
              Free plan includes {FREE_FREEZES_PER_MONTH} freezes per month. Upgrade to Pro for unlimited freezes.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You have{" "}
            <span className="font-semibold text-foreground">
              {freezesRemaining} freeze{freezesRemaining !== 1 ? "s" : ""}
            </span>{" "}
            remaining this month.
          </p>
        )}
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => { onConfirm(); onOpenChange(false); }}
            disabled={noFreezesLeft}
            className="bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            ❄️ Use Freeze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
