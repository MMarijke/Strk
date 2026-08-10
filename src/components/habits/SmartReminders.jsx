import React, { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import { Bell, X, Flame, AlertTriangle, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { calculateStreak } from "./StreakWidget";
import { isOldEnoughForFreeze } from "@/lib/freezeService";
import { cn } from "@/lib/utils";

function buildReminders(habits) {
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const yesterday = format(subDays(now, 1), "yyyy-MM-dd");
  const yesterdayDate = subDays(now, 1);
  yesterdayDate.setHours(0, 0, 0, 0);
  const reminders = [];

  habits.forEach((habit) => {
    const completions = habit.completions || [];
    const streak = calculateStreak(completions);
    const doneToday = completions.includes(today);

    // Streak at risk: has active streak but not done today yet
    if (!doneToday && streak > 0) {
      reminders.push({
        id: `streak-${habit.id}`,
        type: "streak",
        habitName: habit.name,
        color: habit.color,
        message: `${streak}-day streak at risk! Complete "${habit.name}" today.`,
        icon: Flame,
        priority: streak >= 7 ? "high" : "medium",
      });
    }

    // Missed yesterday with no completion today. Gated by the same
    // "habit existed before yesterday" rule getFreezeEligibleDate uses --
    // otherwise a habit backfilled via Edit Completions right after
    // creation (a completion predating created_date) could get flagged
    // here while correctly staying freeze-ineligible on HabitCard/
    // FreezePromptBanner, telling the user to do something the app won't
    // actually let them do.
    if (!doneToday && !completions.includes(yesterday) && completions.length > 0) {
      const last = [...completions].sort().reverse()[0];
      const daysSince = Math.floor(
        (new Date(today + "T00:00:00") - new Date(last + "T00:00:00")) / (1000 * 60 * 60 * 24)
      );
      if (daysSince === 2 && isOldEnoughForFreeze(habit, yesterdayDate)) {
        reminders.push({
          id: `missed-${habit.id}`,
          type: "missed",
          habitName: habit.name,
          color: habit.color,
          message: `You missed "${habit.name}" yesterday. Get back on track!`,
          icon: AlertTriangle,
          priority: "low",
        });
      }
    }

    // Below weekly goal
    if (habit.goal_per_week && !doneToday) {
      const last7 = Array.from({ length: 7 }, (_, i) =>
        format(subDays(new Date(), i), "yyyy-MM-dd")
      );
      const completedLast7 = last7.filter((d) => completions.includes(d)).length;
      const daysLeftInWeek = 7 - new Date().getDay();
      const needed = habit.goal_per_week - completedLast7;
      if (needed > 0 && needed >= daysLeftInWeek) {
        reminders.push({
          id: `goal-${habit.id}`,
          type: "goal",
          habitName: habit.name,
          color: habit.color,
          message: `Need ${needed} more day${needed > 1 ? "s" : ""} this week to hit your "${habit.name}" goal.`,
          icon: TrendingDown,
          priority: "medium",
        });
      }
    }
  });

  // Sort: high > medium > low
  const order = { high: 0, medium: 1, low: 2 };
  return reminders.sort((a, b) => order[a.priority] - order[b.priority]);
}

const PRIORITY_STYLES = {
  high:   "border-l-4 border-destructive bg-destructive/5",
  medium: "border-l-4 bg-accent/10",
  low:    "border-l-4 border-muted-foreground/30 bg-muted/50",
};

export default function SmartReminders({ habits, onActiveChange }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [collapsed, setCollapsed] = useState(false);

  const all = buildReminders(habits);
  const visible = all.filter((r) => !dismissed.has(r.id));

  useEffect(() => {
    onActiveChange?.(visible.length > 0);
  }, [visible.length, onActiveChange]);

  if (visible.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 mb-3 w-full text-left"
      >
        <Bell className="w-4 h-4 text-accent" fill="hsl(var(--accent))" />
        <span className="text-sm font-semibold text-foreground">
          Reminders
        </span>
        <span className="text-xs bg-accent text-white rounded-full px-1.5 py-0.5 font-bold ml-0.5">
          {visible.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{collapsed ? "Show" : "Hide"}</span>
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 overflow-hidden"
          >
            {visible.map((r) => {
              const Icon = r.icon;
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={cn(
                    "flex items-start gap-3 rounded-xl p-3 pr-2",
                    PRIORITY_STYLES[r.priority]
                  )}
                  style={{ borderColor: r.priority === "medium" ? r.color : undefined }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: r.color + "25" }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: r.color }} />
                  </div>
                  <p className="text-sm text-foreground flex-1 leading-snug">{r.message}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setDismissed((prev) => new Set([...prev, r.id]))}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}