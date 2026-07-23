import React, { useState, useEffect } from "react";
import { getFreezesRemaining, getNextRefreshDateStr, FREE_FREEZES_PER_MONTH } from "@/lib/freezeService";

export default function FreezeIndicator({ userEmail, isPro = false }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!userEmail) return;
    getFreezesRemaining(userEmail, isPro).then(setRemaining);
  }, [userEmail, isPro]);

  if (remaining === null) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1.5">
      <span>❄️</span>
      {isPro ? (
        <span>Unlimited freezes (Pro)</span>
      ) : remaining > 0 ? (
        <span>{remaining} freeze{remaining !== 1 ? "s" : ""} this month</span>
      ) : (
        <span>0 freezes — resets {getNextRefreshDateStr()}</span>
      )}
    </div>
  );
}
