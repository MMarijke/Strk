import React from "react";
import { format, subDays, startOfWeek } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { getAllTimeBest } from "@/components/habits/MilestoneBadges";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function calcWeekConsistency(habits, weekDates) {
  if (!habits.length) return 0;
  const total = habits.length * weekDates.length;
  const done = habits.reduce((s, h) => s + weekDates.filter((d) => (h.completions || []).includes(d)).length, 0);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function calcWeekBestStreak(habits, weekDates) {
  // Best streak of any habit considering only completions up to end of that week
  return Math.max(
    0,
    ...habits.map((h) => {
      const weekEnd = weekDates[weekDates.length - 1];
      const filtered = (h.completions || []).filter((d) => d <= weekEnd);
      return getAllTimeBest(filtered);
    })
  );
}

export default function ScoreHistoryChart({ habits, onInvite }) {
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const weekStart = startOfWeek(subDays(new Date(), (3 - i) * 7), { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 7 }, (_, d) =>
      format(new Date(weekStart.getTime() + d * 86400000), "yyyy-MM-dd")
    );
    const consistency = calcWeekConsistency(habits, weekDates);
    const bestStreak = calcWeekBestStreak(habits, weekDates);
    const score = bestStreak * 2 + consistency;
    return {
      label: format(weekStart, "MMM d"),
      score,
      consistency,
      bestStreak,
    };
  });

  const currentScore = weeks[weeks.length - 1]?.score ?? 0;

  return (
    <Card className="border-0 shadow-sm p-5 space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Your Score History
        </p>
        <p className="text-2xl font-bold text-foreground">{currentScore} <span className="text-sm font-normal text-muted-foreground">pts this week</span></p>
        <p className="text-xs text-muted-foreground mt-0.5">Score = Best Streak × 2 + Consistency %</p>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={weeks} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
              color: "hsl(var(--foreground))",
            }}
            formatter={(val, name) => [`${val} pts`, "Score"]}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#scoreGrad)"
            dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="pt-2 border-t border-border">
        <p className="text-sm text-muted-foreground mb-3 text-center">
          Compete with friends — invite them to join!
        </p>
        <Button className="w-full gap-2 rounded-xl" onClick={onInvite}>
          <UserPlus className="w-4 h-4" />
          Invite Friends
        </Button>
      </div>
    </Card>
  );
}