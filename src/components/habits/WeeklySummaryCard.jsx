import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { X, TrendingUp, TrendingDown, Minus, Flame } from "lucide-react";
import { calcWeekCompletionRate, getTopStreakHabit, getMotivationalMessage, getLastMessage, dismissSummary } from "@/lib/weeklySummaryService";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { cn } from "@/lib/utils";

export default function WeeklySummaryCard({ habits, userEmail, onDismiss }) {
  const navigate = useNavigate();

  const lastWeekRate = useMemo(() => calcWeekCompletionRate(habits, 1), [habits]);
  const twoWeeksRate = useMemo(() => calcWeekCompletionRate(habits, 2), [habits]);
  const topHabit = useMemo(() => getTopStreakHabit(habits), [habits]);
  const lastMessage = useMemo(() => getLastMessage(userEmail), [userEmail]);
  const message = useMemo(() => getMotivationalMessage(lastWeekRate, lastMessage), [lastWeekRate, lastMessage]);

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
            ? `↑ Up from ${twoWeeksRate}% the week before${lastWeekRate === 100 ? " — perfect week!" : " — great progress!"}`
            : isDown
            ? `↓ Down from ${twoWeeksRate}% — you've got this week`
            : twoWeeksRate === 0
            ? "First week tracked — nice start!"
            : `Same as last week (${twoWeeksRate}%)`}
        </span>
      </div>

      {/* Top streak habit */}
      {topHabit && (
        <div className="flex items-center gap-1.5 mb-3">
          <Flame className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs text-foreground font-medium">{topHabit.name}</span>
          <span className="text-xs text-muted-foreground">— {calculateStreak(topHabit.completions || [])} day streak</span>
        </div>
      )}

      {/* Motivational message */}
      <p className="text-sm font-medium text-foreground/80 leading-snug pr-4">{message}</p>

      <p className="text-[10px] text-muted-foreground mt-2">Tap to view Trends →</p>
    </div>
  );
}