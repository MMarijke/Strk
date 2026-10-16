import React, { useState, useCallback, useMemo } from "react";
import FreezePromptBanner from "@/components/habits/FreezePromptBanner";
import FocusSessionBanner from "@/components/focus/FocusSessionBanner";
import FocusSessionInviteBanner from "@/components/focus/FocusSessionInviteBanner";
import ChallengeStartBanner from "@/components/groups/ChallengeStartBanner";
import FreezeAssistBanner from "@/components/groups/FreezeAssistBanner";
import SmartReminders from "@/components/habits/SmartReminders";
import WeeklySummaryCard from "@/components/habits/WeeklySummaryCard";
import { cn } from "@/lib/utils";

// Highest-stakes/most time-critical first -- see the design critique's P1
// writeup for the full reasoning. Short version: focus has other people
// waiting in real time; freeze protects the app's core streak asset against
// a real (if soft) yesterday-specific deadline; a new challenge invite and
// today's reminders can both wait a day without cost; the weekly summary is
// pure retrospective, nothing lost by seeing it late.
const PRIORITY = ["focus", "focusInvite", "freeze", "challengeStart", "freezeAssist", "reminders", "weeklySummary"];

/**
 * Consolidates the transient/notification-style Dashboard banners into one
 * tray showing a single highest-priority item at a time, with a "+N more"
 * affordance to reveal the rest -- rather than stacking all of them
 * disclosed at once. Persistent status (StatsBar/RankCard/FreezeIndicator)
 * and ChallengeBanner (ongoing challenge standing, no dismiss, not really a
 * notification) are deliberately NOT part of this component.
 *
 * Every child stays mounted at all times, including when hidden -- each
 * owns its own data fetching/polling/dismiss-state (FocusSessionBanner's
 * poll, SmartReminders' dismissed set, etc.), and unmounting it whenever
 * it's not the featured item would reset that state and stop the polling
 * that lets it report back in the first place. Visibility is CSS-only
 * (`hidden`), never conditional rendering, for exactly that reason.
 */
export default function TodayTray({
  habits,
  userEmail,
  frozenHabitIds,
  isPro,
  freezesRemaining,
  onApplyFreeze,
  onOpenSession,
  onFocusInviteJoined,
  onReminderClick,
  showSummary,
  onDismissSummary,
  groups,
  profiles,
  freezesUsedThisMonth,
}) {
  const [activeSet, setActiveSet] = useState(() => new Set());
  const [expanded, setExpanded] = useState(false);

  const setActive = useCallback((key, isActive) => {
    setActiveSet((prev) => {
      if (prev.has(key) === isActive) return prev;
      const next = new Set(prev);
      if (isActive) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  const onFreezeActiveChange = useCallback((v) => setActive("freeze", v), [setActive]);
  const onFocusActiveChange = useCallback((v) => setActive("focus", v), [setActive]);
  const onChallengeStartActiveChange = useCallback((v) => setActive("challengeStart", v), [setActive]);
  const onFreezeAssistActiveChange = useCallback((v) => setActive("freezeAssist", v), [setActive]);
  const onFocusInviteActiveChange = useCallback((v) => setActive("focusInvite", v), [setActive]);
  const onRemindersActiveChange = useCallback((v) => setActive("reminders", v), [setActive]);

  // WeeklySummaryCard doesn't determine its own visibility the way the
  // other four do -- Dashboard already owns that via showSummary
  // (isSummaryVisible()) -- so it's folded in directly rather than wired
  // through an onActiveChange report.
  const fullActiveSet = useMemo(() => {
    if (!showSummary) return activeSet;
    const next = new Set(activeSet);
    next.add("weeklySummary");
    return next;
  }, [activeSet, showSummary]);

  const activeOrdered = PRIORITY.filter((k) => fullActiveSet.has(k));
  const topKey = activeOrdered[0];
  const extraCount = activeOrdered.length - 1;
  const isVisible = (key) => topKey === key || (expanded && fullActiveSet.has(key));

  return (
    <>
      <div className={cn(!isVisible("freeze") && "hidden")}>
        <FreezePromptBanner
          habits={habits}
          frozenHabitIds={frozenHabitIds}
          isPro={isPro}
          freezesRemaining={freezesRemaining}
          onApplyFreeze={onApplyFreeze}
          onActiveChange={onFreezeActiveChange}
        />
      </div>

      {userEmail && (
        <div className={cn(!isVisible("focus") && "hidden")}>
          <FocusSessionBanner userEmail={userEmail} onOpen={onOpenSession} onActiveChange={onFocusActiveChange} />
        </div>
      )}

      {userEmail && (
        <div className={cn(!isVisible("focusInvite") && "hidden")}>
          <FocusSessionInviteBanner
            userEmail={userEmail}
            onJoined={onFocusInviteJoined}
            onActiveChange={onFocusInviteActiveChange}
          />
        </div>
      )}

      {userEmail && (
        <div className={cn(!isVisible("challengeStart") && "hidden")}>
          <ChallengeStartBanner userEmail={userEmail} onActiveChange={onChallengeStartActiveChange} />
        </div>
      )}

      {userEmail && (
        <div className={cn(!isVisible("freezeAssist") && "hidden")}>
          <FreezeAssistBanner userEmail={userEmail} onActiveChange={onFreezeAssistActiveChange} />
        </div>
      )}

      <div className={cn(!isVisible("reminders") && "hidden")}>
        <SmartReminders habits={habits} onActiveChange={onRemindersActiveChange} onReminderClick={onReminderClick} />
      </div>

      {showSummary && (
        <div className={cn("mb-4", !isVisible("weeklySummary") && "hidden")}>
          <WeeklySummaryCard
            habits={habits}
            userEmail={userEmail}
            onDismiss={onDismissSummary}
            groups={groups}
            profiles={profiles}
            freezesUsedThisMonth={freezesUsedThisMonth}
          />
        </div>
      )}

      {extraCount > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          // px-2 py-2 grows the real hit area -- this line had no padding
          // at all, so its clickable height was just the text line box
          // (~16-18px). -mx-2 cancels the horizontal growth against
          // neighboring content, matching the existing mb-4/-mt-1 vertical
          // spacing rather than replacing it (distinct properties, so no
          // Tailwind class-order ambiguity).
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 -mt-1 px-2 py-2 -mx-2"
        >
          {expanded ? "Show less" : `+${extraCount} more`}
        </button>
      )}
    </>
  );
}
