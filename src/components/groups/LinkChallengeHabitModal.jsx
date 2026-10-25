import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pick which of your own habits counts for a challenge.
 *
 * This is where the name match lives now. It used to BE the mechanism —
 * `lower(h.name) = lower(challenge.habit_name)` decided whether your
 * progress counted, so tracking the same thing under a different name meant
 * 0% forever with no way to fix it short of guessing the exact string.
 * Here it only pre-selects, and the user can override it.
 *
 * Single-select, and it DOES pre-select, unlike HabitSharePicker which
 * deliberately pre-selects nothing. The difference is what is being asked:
 * sharing a habit is a consent decision, so a pre-tick would be consent
 * nobody gave. This is a mechanical "which of yours is this one", where a
 * sensible default saves almost everybody a decision.
 */
export default function LinkChallengeHabitModal({
  open,
  onOpenChange,
  habitName,
  habits = [],
  currentHabitId,
  saving = false,
  onSave,
}) {
  // Archived habits are absent: the server refuses to link one, because the
  // dashboard filters them out and linking one would leave you believing
  // you had linked something that can never register a completion.
  const active = habits.filter((h) => !h.archived);

  const suggested = active.find(
    (h) => h.name.trim().toLowerCase() === (habitName || "").trim().toLowerCase()
  );

  const [selected, setSelected] = useState(currentHabitId || suggested?.id || null);

  // Re-seed on open only. Without the guard this would also fire whenever
  // the habits list refetched and handed down a new array, discarding a
  // choice the user had just made.
  // Depends on `open` alone, deliberately: currentHabitId and suggested are
  // read but not depended on, so a refetch cannot reset the choice mid-edit.
  useEffect(() => {
    if (open) setSelected(currentHabitId || suggested?.id || null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle id="link-challenge-habit-title">
            Which habit counts for &ldquo;{habitName}&rdquo;?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground">
            Pick one of your habits. Its check-ins during the challenge are what the leaderboard counts — the
            names don&apos;t have to match.
          </p>

          {active.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You don&apos;t have any active habits yet. Create one and you can join in.
            </p>
          ) : (
            <div
              className="space-y-1.5 max-h-52 overflow-y-auto"
              role="radiogroup"
              aria-labelledby="link-challenge-habit-title"
            >
              {active.map((h) => {
                const isSelected = selected === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={saving}
                    onClick={() => setSelected(h.id)}
                    className={cn(
                      "w-full min-h-11 flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left transition-all",
                      "outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      isSelected ? "border-primary bg-primary/5" : "border-transparent bg-muted hover:bg-muted/80",
                      saving && "opacity-60"
                    )}
                  >
                    <span className="text-sm font-medium truncate">{h.name}</span>
                    {/* Says why it is already chosen, so a pre-selection
                        never looks like a decision the app made silently. */}
                    {suggested?.id === h.id && !currentHabitId && (
                      <span className="text-[10px] text-muted-foreground shrink-0">same name</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1 h-11"
              onClick={() => onSave(selected)}
              disabled={saving || !selected}
            >
              {saving ? "Saving…" : "Count this habit"}
            </Button>
            {/* Unlinking is only offered when there is something to unlink,
                so the control never implies a state you are not in. */}
            {currentHabitId && (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => onSave(null)}
                disabled={saving}
              >
                Unlink
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
