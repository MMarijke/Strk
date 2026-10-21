import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { format, subDays, isSameDay, parseISO } from "date-fns";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { FROZEN_CELL_STYLE, FROZEN_CELL_TITLE } from "./frozenCell";

function calculateStreak(completions, frozenDate = null) {
  // Build effective completions including frozen date
  const effective = [...(completions || [])];
  if (frozenDate && !effective.includes(frozenDate)) {
    effective.push(frozenDate);
  }

  if (effective.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = subDays(today, 1);

  // Deduplicate and sort descending
  const dates = [...new Set(effective)]
    .map((d) => parseISO(d))
    .map((d) => { d.setHours(0, 0, 0, 0); return d; })
    .sort((a, b) => b - a);

  // The streak must include today or yesterday to be active
  const mostRecent = dates[0];
  if (!isSameDay(mostRecent, today) && !isSameDay(mostRecent, yesterday)) {
    return 0;
  }

  // Walk backwards: each date must be exactly 1 day before the previous
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const expected = subDays(dates[i - 1], 1);
    if (isSameDay(dates[i], expected)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// The highest streak currently running across a set of habits.
//
// Extracted from DashboardSummary, where it was an inline reduce that
// called calculateStreak WITHOUT each habit's frozen date -- so a streak
// held together by a streak freeze broke at the frozen day and the summary
// disagreed with the habit's own card, which has always passed it. The
// per-habit behaviour was covered by tests; the aggregate that got it
// wrong was not reachable by any, because it lived inside a component.
// It lives here, beside calculateStreak and exported, so it can be.
//
// frozenHabits is keyed by habit id, matching the map Dashboard already
// holds and passes to HabitCard.
export function bestActiveStreak(habits = [], frozenHabits = {}) {
  return habits.reduce((max, h) => {
    const streak = calculateStreak(h.completions || [], frozenHabits[h.id] || null);
    return streak > max ? streak : max;
  }, 0);
}

export default function StreakWidget({ completions = [], color = "hsl(var(--primary))", frozenDate = null, streak: precomputedStreak }) {
  // HabitCard already computes this exact value (same completions +
  // frozenDate) for its own freeze-eligibility logic and passes it down --
  // accepting it as a prop avoids running the O(n log n) sort/walk twice
  // for the same habit on every render. Falls back to computing it locally
  // (memoized) for any other caller that doesn't have it precomputed.
  const ownStreak = useMemo(() => (
    precomputedStreak !== undefined ? null : calculateStreak(completions, frozenDate)
  ), [completions, frozenDate, precomputedStreak]);
  const streak = precomputedStreak ?? ownStreak;
  const today = new Date();

  // Last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(today, 6 - i);
    const dateStr = format(date, "yyyy-MM-dd");
    const isCompleted = completions.includes(dateStr);
    const isFrozen = frozenDate === dateStr;
    const isToday = isSameDay(date, today);
    return { date, dateStr, isCompleted, isFrozen, isToday, label: format(date, "EEE").charAt(0) };
  });

  return (
    <div className="flex items-center gap-4">
      {/* Streak counter */}
      <div className="flex items-center gap-1.5">
        {/* Considered restrained on purpose: this fires on every habit
            check-off, potentially many times a day across several habits,
            so it can't afford to be a "celebration" (confetti, a modal) --
            delight has to survive the hundredth use, not just the first.
            The flame itself flaring briefly when the count changes is a
            small, specific-to-this-product acknowledgment instead of a
            generic checkmark bounce. key={streak} remounts (and replays
            the entrance) only when the number actually changes, not on
            every render. */}
        <motion.div
          key={streak}
          initial={{ scale: 1.35, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Flame
            className={cn("w-5 h-5 transition-all", streak === 0 && "opacity-30")}
            style={{ color: color, fill: color, stroke: "none" }}
          />
        </motion.div>
        <span className={cn(
          "text-lg font-bold tabular-nums",
          streak > 0 ? "text-foreground" : "text-muted-foreground/50"
        )}>
          {streak}
        </span>
      </div>

      {/* Day dots */}
      <div className="flex items-center gap-1.5">
        {days.map((day) => (
          <div key={day.dateStr} className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground/60 font-medium">
              {day.label}
            </span>
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300",
                day.isCompleted ? "scale-100" : day.isFrozen ? "scale-100" : "bg-muted scale-90",
                day.isToday && !day.isCompleted && !day.isFrozen && "ring-2 ring-border ring-offset-1 ring-offset-background"
              )}
              style={day.isCompleted ? { backgroundColor: color } : day.isFrozen ? FROZEN_CELL_STYLE : undefined}
              title={day.isFrozen ? FROZEN_CELL_TITLE : undefined}
            >
              {day.isCompleted && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {day.isFrozen && (
                <span className="text-[10px] leading-none">❄️</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { calculateStreak };