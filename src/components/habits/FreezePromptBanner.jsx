import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import NotificationBanner from "@/components/dashboard/NotificationBanner";
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
      <NotificationBanner
        tone="frozen"
        icon={<span className="text-base leading-none">❄️</span>}
        title={`You missed ${candidate.name} yesterday`}
        subtitle="Use a freeze to keep your streak alive"
        onDismiss={handleDismiss}
        action={
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setConfirmHabit(candidate)}
          >
            ❄️ Freeze
          </Button>
        }
      />

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
