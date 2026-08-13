import React from "react";
import { getNextRefreshDateStr } from "@/lib/freezeService";

// freezesRemaining comes from Dashboard.jsx's single getFreezeMonthState()
// call, not fetched here -- this used to independently re-fetch the same
// streak_freezes row Dashboard.jsx (and every HabitCard) already fetch.
// null (not a number) means "not loaded yet", matching Dashboard.jsx's
// initial state, so this renders nothing during that brief window instead
// of flashing "0 freezes" before the real value arrives.
export default function FreezeIndicator({ isPro = false, freezesRemaining = null }) {
  if (freezesRemaining === null) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1.5">
      <span>❄️</span>
      {isPro ? (
        <span>Unlimited freezes (Pro)</span>
      ) : freezesRemaining > 0 ? (
        <span>{freezesRemaining} freeze{freezesRemaining !== 1 ? "s" : ""} this month</span>
      ) : (
        <span>0 freezes, resets {getNextRefreshDateStr()}</span>
      )}
    </div>
  );
}
