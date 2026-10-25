import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import HabitSharePicker from "./HabitSharePicker";

/**
 * Change what an existing partner can see.
 *
 * Consent that cannot be withdrawn is not consent, so this is the same
 * screen in both directions -- there is no separate "stop sharing" flow,
 * just a selection that can go down as well as up.
 *
 * Removing a habit is deliberately silent: the partner's row simply
 * disappears, which is visible on its own. A notification would turn
 * retracting consent into something you get called out for, which is the
 * fastest way to make people stop using the control at all.
 */
export default function ShareScopeModal({
  open,
  onOpenChange,
  userEmail,
  partnerName,
  initialSelected = [],
  saving = false,
  onSave,
}) {
  const [selected, setSelected] = useState(initialSelected);

  // Re-seed each time it opens. Without the `open` guard this would also
  // fire mid-edit whenever the dashboard refetched and handed down a new
  // initialSelected array, throwing away what the user had just picked.
  // Depends on `open` alone, deliberately -- initialSelected is read but
  // not depended on, so a refetch cannot reset the picker mid-edit.
  useEffect(() => {
    if (open) setSelected(initialSelected);
  }, [open]);

  const removing = initialSelected.filter((id) => !selected.includes(id)).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>What {partnerName} can see</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground">
            Only the habits you pick, and only their name, streak and whether you checked in today. Never your past days.
          </p>

          <HabitSharePicker
            userEmail={userEmail}
            selected={selected}
            onChange={setSelected}
            disabled={saving}
          />

          {/* Stated before saving, not after. Un-sharing is silent to the
              partner, which makes it the user's own decision -- so they
              are the one person who has to be told what it does. */}
          {removing > 0 && (
            <p className="text-xs text-muted-foreground">
              {removing === 1 ? "1 habit" : `${removing} habits`} will disappear from {partnerName}&apos;s view. They
              won&apos;t be told.
            </p>
          )}

          {/* The label states the outcome, including the one where the
              answer is nothing. */}
          <Button className="w-full h-11" onClick={() => onSave(selected)} disabled={saving}>
            {saving
              ? "Saving…"
              : selected.length === 0
                ? "Share nothing"
                : `Share ${selected.length} habit${selected.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
