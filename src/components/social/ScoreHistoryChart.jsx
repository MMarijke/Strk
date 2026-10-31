import React from "react";
import { format, subDays, startOfWeek } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { calculateStats } from "@/lib/utils";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Four weekly samples of THE score -- the same number the leaderboard
 * shows, taken at four points in time.
 *
 * This file used to compute its own, and got a different answer for the
 * same user on the same data while printing the leaderboard's exact
 * caption, "Score = Best Streak x 2 + Consistency %". Measured on one
 * habit kept perfectly for 30 days plus one long-archived habit: the
 * leaderboard said 100% consistency, this said 43%.
 *
 * Three separate causes, all gone now that it calls calculateStats:
 *
 *   - It averaged over a 7-day window, not the 30-day window every other
 *     consistency figure in the app uses. Two different measurements under
 *     one label.
 *   - It never filtered archived habits, so a retired habit halved the
 *     number -- the exact bug 20261025090002 fixed for calculateStats and
 *     the stats trigger.
 *   - Its denominator was always habits x 7, including days of the current
 *     week that have not happened yet. On a Monday the highest score
 *     attainable was 1/7, or 14%.
 *
 * calculateStats takes an as-of date precisely so this can reuse it rather
 * than keep a second definition in step by hand.
 */
function weeklySamples(habits, witness) {
  const today = new Date();
  return Array.from({ length: 4 }, (_, i) => {
    const weekStart = startOfWeek(subDays(today, (3 - i) * 7), { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    // The current week is not over. Sampling at its Sunday would measure a
    // 30-day window running into the future and read as a slump that is
    // really just days that have not arrived.
    const asOf = weekEnd > today ? today : weekEnd;
    // The CURRENT witness factor is applied to every sample, including the
    // older ones. Historical witness is not recorded anywhere -- only the
    // live slots are stored -- so the alternative was to plot the base and
    // let the headline disagree with the leaderboard, which is the exact
    // defect this component was rebuilt to remove. Scaling all four points
    // by today's multiplier keeps the latest one equal to the leaderboard
    // and makes the line "how my base has moved, at the level I am
    // witnessed now". That is a real approximation and it is the one worth
    // taking.
    const { score, consistency, rollingBest } = calculateStats(habits, asOf, witness);
    return { label: format(weekStart, "MMM d"), score, consistency, bestStreak: rollingBest };
  });
}

export default function ScoreHistoryChart({ habits, onInvite, witness = 0 }) {
  const weeks = weeklySamples(habits, witness);

  const currentScore = weeks[weeks.length - 1]?.score ?? 0;

  return (
    <Card className="border-0 shadow-sm p-5 space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Your Score History
        </p>
        <p className="text-2xl font-bold text-foreground">{currentScore} <span className="text-sm font-normal text-muted-foreground">pts</span></p>
        {/* No longer "pts this week". This is the current score -- the same
            figure the leaderboard ranks on -- with the three earlier points
            showing where it has been. Saying "this week" while displaying a
            30-day measure was part of what made the old number read as a
            different, smaller statistic. */}
        <p className="text-xs text-muted-foreground mt-0.5">Score = Best Streak × 2 + Consistency %, sampled weekly</p>
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
          Compete with friends: invite them to join!
        </p>
        <Button className="w-full gap-2 rounded-xl" onClick={onInvite}>
          <UserPlus className="w-4 h-4" />
          Invite Friends
        </Button>
      </div>
    </Card>
  );
}