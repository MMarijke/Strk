import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import FreezeConfirmModal from "./FreezeConfirmModal";
import { getFreezeEligibleDate } from "@/lib/freezeService";

const DISMISS_KEY_PREFIX = "freezePromptDismissed_";

function isDismissed(habitId, missedDate) {
  return localStorage.getItem(`${DISMISS_KEY_PREFIX}${habitId}_${missedDate}`) === "true";
}

function dismiss(habitId, missedDate) {
  localStorage.setItem(`${DISMISS_KEY_PREFIX}${habitId}_${missedDate}`, "true");
}

/**
 * Dashboard-level, more-visible counterpart to the small inline "Freeze?"
 * link on each HabitCard — surfaces the first habit that missed exactly
 * yesterday (and isn't already frozen or dismissed) above the habit list,
 * rather than requiring the user to notice it on that habit's own card.
 */
export default function FreezePromptBanner({ habits, frozenHabitIds, isPro, freezesRemaining, onApplyFreeze, onActiveChange }) {
  const [, forceRender] = useState(0);
  const [confirmHabit, setConfirmHabit] = useState(null);

  const candidate = habits.find((h) => {
    const eligibleDate = getFreezeEligibleDate(h);
    if (!eligibleDate) return false;
    if (frozenHabitIds?.has(h.id)) return false;
    if (isDismissed(h.id, eligibleDate)) return false;
    return true;
  });

  useEffect(() => {
    onActiveChange?.(!!candidate);
  }, [!!candidate, onActiveChange]);

  if (!candidate) return null;
  const missedDate = getFreezeEligibleDate(candidate);

  const handleDismiss = () => {
    dismiss(candidate.id, missedDate);
    forceRender((n) => n + 1);
  };

  return (
    <>
      <div className="mb-4 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-base leading-none">❄️</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground truncate">
            You missed {candidate.name} yesterday
          </p>
          <p className="text-[11px] text-muted-foreground">
            Use a freeze to keep your streak alive
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => setConfirmHabit(candidate)}
        >
          ❄️ Freeze
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 h-7 w-7 rounded-full hover:bg-primary/10"
          onClick={handleDismiss}
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </div>

      <FreezeConfirmModal
        open={!!confirmHabit}
        onOpenChange={(open) => !open && setConfirmHabit(null)}
        habit={confirmHabit}
        freezesRemaining={freezesRemaining}
        isPro={isPro}
        onConfirm={() => {
          onApplyFreeze(confirmHabit.id, missedDate);
          setConfirmHabit(null);
        }}
      />
    </>
  );
}
