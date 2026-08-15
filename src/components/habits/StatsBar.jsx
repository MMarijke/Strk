import React from "react";
import { format } from "date-fns";
import { Flame, Target, CalendarCheck } from "lucide-react";
import { calculateStreak } from "./StreakWidget";

export default function StatsBar({ habits }) {
  const today = format(new Date(), "yyyy-MM-dd");

  const completedToday = habits.filter(
    (h) => (h.completions || []).includes(today)
  ).length;

  const totalHabits = habits.length;

  const longestStreak = habits.reduce((max, h) => {
    const streak = calculateStreak(h.completions || []);
    return streak > max ? streak : max;
  }, 0);

  const stats = [
  { label: "Today", value: `${completedToday}/${totalHabits}`, icon: CalendarCheck, color: "text-primary" },
  { label: "Habits", value: totalHabits, icon: Target, color: "text-chart-3" },
  { label: "Current Streak", value: longestStreak, icon: Flame, color: "text-accent" }];


  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat) =>
      <div
        key={stat.label}
        className="bg-card rounded-xl p-4 flex items-center gap-3 shadow-sm">
        
          <div className="p-2 rounded-lg bg-muted">
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
          </div>
          <div>
            <p className="font-bold text-foreground leading-none text-base">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </div>
        </div>
      )}
    </div>);

}