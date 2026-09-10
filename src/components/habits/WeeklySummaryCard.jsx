import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { X, TrendingUp, TrendingDown, Minus, Flame, Users } from "lucide-react";
import { calcWeekCompletionRate, getTopStreakHabit, getMotivationalMessage, getLastMessage, dismissSummary } from "@/lib/weeklySummaryService";
import { getWeekCompletions, buildMemberWeeklyRankings } from "@/lib/groupDigestService";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { cn } from "@/lib/utils";

const MAX_HABITS_SHOWN = 5;

export default function WeeklySummaryCard({ habits, userEmail, onDismiss, groups = [], profiles = [], freezesUsedThisMonth = 0 }) {
  const navigate = useNavigate();

  const lastWeekRate = useMemo(() => calcWeekCompletionRate(habits, 1), [habits]);
  const twoWeeksRate = useMemo(() => calcWeekCompletionRate(habits, 2), [habits]);
  const topHabit = useMemo(() => getTopStreakHabit(habits), [habits]);
  const lastMessage = useMemo(() => getLastMessage(userEmail), [userEmail]);
  const message = useMemo(() => getMotivationalMessage(lastWeekRate, lastMessage), [lastWeekRate, lastMessage]);

  // Per-habit breakdown for last week -- capped so the card stays scannable
  // rather than turning into a second Trends page. The full picture is one
  // tap away (the whole card navigates to /Trends).
  const habitBreakdown = useMemo(
    () => habits.map((h) => ({ id: h.id, name: h.name, count: getWeekCompletions(h.completions || [], 1).length })),
    [habits]
  );
  const shownHabits = habitBreakdown.slice(0, MAX_HABITS_SHOWN);
  const hiddenHabitCount = habitBreakdown.length - shownHabits.length;

  // Reuses the exact same ranking helper GroupWeeklyReport.jsx uses, so
  // "no data yet" (groupmates whose stats haven't been computed by
  // send-weekly-digest yet) degrades identically everywhere in the app.
  // Only the first group, to keep a compact card compact -- the full
  // breakdown for every group already lives one tap away in that group's
  // own weekly report.
  const primaryGroup = groups[0] || null;
  const groupRank = useMemo(() => {
    if (!primaryGroup) return null;
    const rankings = buildMemberWeeklyRankings(primaryGroup.member_emails || [], userEmail, habits, profiles);
    if (rankings.length < 2) return null; // ranking against nobody isn't useful
    const myIndex = rankings.findIndex((r) => r.email === userEmail);
    if (myIndex === -1) return null;
    return { rank: myIndex + 1, total: rankings.length };
  }, [primaryGroup, userEmail, habits, profiles]);

  const diff = lastWeekRate - twoWeeksRate;
  const isUp = diff > 0;
  const isDown = diff < 0;

  const bgClass = lastWeekRate >= 80
    ? "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20"
    : lastWeekRate >= 50
    ? "bg-gradient-to-r from-accent/10 to-accent/5 border-accent/20"
    : "bg-gradient-to-r from-muted to-muted/50 border-border";

  const handleDismiss = (e) => {
    e.stopPropagation();
    dismissSummary(userEmail, message);
    onDismiss();
  };

  const handleCardClick = () => {
    navigate("/Trends");
  };

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "relative rounded-2xl border p-4 cursor-pointer transition-all hover:shadow-md",
        bgClass
      )}
    >
      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 w-6 h-6 rounded-full bg-background/60 flex items-center justify-center hover:bg-background transition-colors"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Last Week's Summary
      </p>

      {/* Completion rate */}
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-2xl font-bold text-foreground">{lastWeekRate}%</span>
        <span className="text-sm text-muted-foreground">completion rate</span>
      </div>

      {/* Comparison */}
      <div className="flex items-center gap-1 mb-3">
        {isUp ? (
          <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
        ) : isDown ? (
          <TrendingDown className="w-3.5 h-3.5 text-destructive shrink-0" />
        ) : (
          <Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs text-muted-foreground">
          {isUp
            ? `↑ Up from ${twoWeeksRate}% the week before${lastWeekRate === 100 ? ". Perfect week!" : ". Great progress!"}`
            : isDown
            ? `↓ Down from ${twoWeeksRate}%. You've got this week`
            : twoWeeksRate === 0
            ? "First week tracked. Nice start!"
            : `Same as last week (${twoWeeksRate}%)`}
        </span>
      </div>

      {/* Per-habit breakdown */}
      {shownHabits.length > 0 && (
        <div className="space-y-1 mb-3">
          {shownHabits.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground truncate">{h.name}</span>
              <span className="text-xs text-muted-foreground font-medium tabular-nums shrink-0">{h.count}/7</span>
            </div>
          ))}
          {hiddenHabitCount > 0 && (
            <p className="text-[10px] text-muted-foreground">
              +{hiddenHabitCount} more habit{hiddenHabitCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Freezes used this month */}
      {freezesUsedThisMonth > 0 && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm leading-none">❄️</span>
          <span className="text-xs text-muted-foreground">
            {freezesUsedThisMonth} freeze{freezesUsedThisMonth !== 1 ? "s" : ""} used this month
          </span>
        </div>
      )}

      {/* Top streak habit */}
      {topHabit && (
        <div className="flex items-center gap-1.5 mb-3">
          <Flame className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs text-foreground font-medium">{topHabit.name}</span>
          <span className="text-xs text-muted-foreground">{calculateStreak(topHabit.completions || [])} day streak</span>
        </div>
      )}

      {/* Group rank -- only shown once there's someone real to compare
          against (rankings.length >= 2); a lightweight pointer into the
          full GroupWeeklyReport rather than duplicating it here. */}
      {groupRank && (
        <div className="flex items-center gap-1.5 mb-3">
          <Users className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs text-foreground">
            <span className="font-semibold">#{groupRank.rank}</span> of {groupRank.total} in {primaryGroup.name} this week
          </span>
        </div>
      )}

      {/* Motivational message */}
      <p className="text-sm font-medium text-foreground/80 leading-snug pr-4">{message}</p>

      <p className="text-[10px] text-muted-foreground mt-2">Tap to view Trends →</p>
    </div>
  );
}
