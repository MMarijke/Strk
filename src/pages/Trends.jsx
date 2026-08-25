import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Habit } from "@/api/entities";
import { format, subDays, startOfWeek, subWeeks } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import { TrendingUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { getAllTimeBest } from "@/components/habits/MilestoneBadges";
import { useSubscription } from "@/hooks/useSubscription";
import UpgradeModal from "@/components/upgrade/UpgradeModal";
import { HABIT_COLORS as STROKE_COLORS } from "@/lib/utils";

// STROKE_COLORS has 8 entries; the 9th+ uncustomized habit reuses one of
// them via i % STROKE_COLORS.length, which makes two lines identical and
// indistinguishable in the chart. Habits past the first full cycle get a
// dash pattern layered on top of the repeated color so they stay visually
// distinct instead of overlapping.
const DASH_PATTERNS = [undefined, "6 3", "2 3", "1 4"];

function buildWeeklyData(habits, numWeeks = 12) {
  const today = new Date();
  const weeks = Array.from({ length: numWeeks }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(today, numWeeks - 1 - i), { weekStartsOn: 1 });
    const weekDays = Array.from({ length: 7 }, (_, d) => format(subDays(weekStart, -d), "yyyy-MM-dd"));
    return { weekLabel: format(weekStart, "MMM d"), weekDays };
  });

  return weeks.map(({ weekLabel, weekDays }) => {
    const row = { week: weekLabel };
    habits.forEach((h) => {
      const completions = h.completions || [];
      const count = weekDays.filter((d) => completions.includes(d)).length;
      row[h.name] = count;
    });
    return row;
  });
}

export default function Trends() {
  const { user } = useAuth();
  const { isPro, isLoading: subLoading } = useSubscription();
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { data: habits = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["habits", user?.email],
    queryFn: () => user?.email
      ? Habit.filter({ created_by: user.email }, "-created_date")
      : [],
    enabled: !!user?.email,
  });

  const weeklyData = buildWeeklyData(habits);

  const today = format(new Date(), "yyyy-MM-dd");
  const last30 = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 pb-8" style={{ paddingTop: `calc(env(safe-area-inset-top) + 2rem)` }}>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Trends
          </h1>
          <p className="text-sm text-muted-foreground">12-week completion overview</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => <div key={i} className="h-48 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : isError ? (
          <Card className="border-0 shadow-sm p-5 border border-destructive/20">
            <p className="text-sm font-semibold text-destructive mb-1">Couldn't load your trends</p>
            <p className="text-xs text-muted-foreground mb-4">
              Something went wrong fetching your habit history. Please try again.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </Card>
        ) : habits.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No habits yet</div>
        ) : (
          <div className="space-y-6">

            {/* Weekly completion line chart */}
            <Card className="p-5 border-0 shadow-sm">
              <h2 className="font-semibold text-sm mb-4">Weekly Completions per Habit</h2>
              <div className="relative">
                {/* The SVG chart conveys nothing to a screen reader on its
                    own (no ARIA, no text nodes); it's hidden from the
                    accessibility tree and replaced with the sr-only table
                    below, which carries the same weeklyData. */}
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        interval={2}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, 7]}
                        ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
                        width={20}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(val, name) => [`${val} days`, name]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      {habits.map((h, i) => {
                        const colorCycle = Math.floor(i / STROKE_COLORS.length);
                        return (
                          <Line
                            key={h.id}
                            type="monotone"
                            dataKey={h.name}
                            stroke={h.color || STROKE_COLORS[i % STROKE_COLORS.length]}
                            strokeDasharray={!h.color ? DASH_PATTERNS[colorCycle % DASH_PATTERNS.length] : undefined}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* table-layout: fixed (previous fix) only controls column
                    sizing once the table's own box is already constrained
                    -- it doesn't touch the separate, long-standing
                    cross-browser inconsistency in how `overflow`/`width`
                    apply to a <table>'s anonymous "table wrapper box" vs.
                    its inner table box. That's a real, sometimes-engine
                    -specific gap, not something fixable from inside the
                    table model. Replacing the table with a plain <dl>
                    sidesteps it entirely: a <dl> is an ordinary block box,
                    governed by the same simple, universally-consistent
                    overflow model every other sr-only element on this
                    page (and site) already relies on safely. Confirmed via
                    a real-device test that table-layout: fixed alone did
                    not fully resolve the mobile zoom bug (see conversation
                    history) -- this replaces that approach, not layers on
                    top of it. Conveys the identical per-week, per-habit
                    data the table did, just as term/description pairs
                    instead of rows/cells. */}
                <div className="sr-only">
                  <p>Weekly habit completions, last 12 weeks (days completed out of 7 per week).</p>
                  <dl>
                    {weeklyData.map((row) => (
                      <React.Fragment key={row.week}>
                        <dt>{row.week}</dt>
                        <dd>
                          {habits.map((h) => `${h.name}: ${row[h.name]} of 7 days`).join(". ")}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>

                {/* Free plan only sees the most recent 4 of 12 weeks — the
                    other 8 (oldest, leftmost) are blurred behind an upsell.
                    Starts at left-5 (20px) to clear the YAxis's own width
                    (width={20} above) so the 0-7 scale stays readable; the
                    width is reduced by that same 20px so the right edge —
                    the actual free/paywalled data cutoff — doesn't move. */}
                {!subLoading && !isPro && (
                  <div className="absolute inset-y-0 left-5 w-[calc(66.6667%_-_1.25rem)] flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-md">
                    <div className="text-center px-4">
                      <p className="text-xs font-semibold text-foreground mb-2">
                        Unlock full 12-week trends
                      </p>
                      <Button size="sm" onClick={() => setShowUpgrade(true)} className="gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        Upgrade to Pro
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Per-habit stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {habits.map((h, i) => {
                const completions = h.completions || [];
                const streak = calculateStreak(completions);
                const best = getAllTimeBest(completions);
                const last30Count = last30.filter((d) => completions.includes(d)).length;
                const rate30 = Math.round((last30Count / 30) * 100);
                const color = h.color || STROKE_COLORS[i % STROKE_COLORS.length];

                // 4-week trend: compare last 2 weeks vs 2 weeks before that
                const w1 = Array.from({ length: 14 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
                const w2 = Array.from({ length: 14 }, (_, i) => format(subDays(new Date(), 14 + i), "yyyy-MM-dd"));
                const c1 = w1.filter((d) => completions.includes(d)).length;
                const c2 = w2.filter((d) => completions.includes(d)).length;
                const trend = c1 > c2 ? "↑ Improving" : c1 < c2 ? "↓ Declining" : "→ Steady";
                const trendColor = c1 > c2 ? "text-primary" : c1 < c2 ? "text-destructive" : "text-muted-foreground";

                return (
                  <Card key={h.id} className="p-4 border-0 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: color }} />
                    <div className="pl-2">
                      <p className="font-semibold text-sm break-words">{h.name}</p>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <p className="text-lg font-bold text-foreground">{streak}</p>
                          <p className="text-[10px] text-muted-foreground">Current streak</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{best}</p>
                          <p className="text-[10px] text-muted-foreground">Best ever</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{rate30}%</p>
                          <p className="text-[10px] text-muted-foreground">Last 30 days</p>
                        </div>
                      </div>
                      <p className={`text-xs font-medium mt-2 ${trendColor}`}>{trend}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}