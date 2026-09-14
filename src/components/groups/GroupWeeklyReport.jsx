import React from "react";
import { format, subDays, startOfWeek, endOfWeek, parseISO, isAfter } from "date-fns";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Trophy, Flame, Star, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { calcWeeklyRate, buildMemberWeeklyRankings, getGroupTopHabitLastWeek } from "@/lib/groupDigestService";
import { getDisplayName } from "@/lib/displayName";

function TrendIcon({ diff }) {
  if (diff > 0) return <TrendingUp className="w-4 h-4 text-primary" />;
  if (diff < 0) return <TrendingDown className="w-4 h-4 text-destructive" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function StatCard({ label, value, sub, highlight }) {
  return (
    <div className={cn("rounded-xl p-4 space-y-1", highlight ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted/60")}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function GroupWeeklyReport({ group, habits, userEmail, challenges, profiles = [], onBack }) {
  const today = new Date();
  const weekStart = startOfWeek(subDays(today, 7), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(subDays(today, 7), { weekStartsOn: 1 });
  const weekLabel = `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d")}`;

  const memberEmails = group.member_emails || [];
  const thisWeekRate = calcWeeklyRate(habits, 1);
  const prevWeekRate = calcWeeklyRate(habits, 2);
  const rateDiff = thisWeekRate - prevWeekRate;

  const rankings = buildMemberWeeklyRankings(memberEmails, userEmail, habits, profiles)
    .map((m) => ({ ...m, name: getDisplayName(m.email, profiles) }));

  const groupTopHabit = getGroupTopHabitLastWeek(memberEmails, userEmail, habits, profiles);

  // Most improved / most consistent only ever consider members with real
  // data -- a hasData: false row's null improvement would otherwise win
  // "Most Improved" by default whenever no one else has a digest run yet.
  const rankedWithData = rankings.filter((m) => m.hasData);
  const mostImproved = rankedWithData.reduce((best, m) => (!best || m.improvement > best.improvement) ? m : best, null);
  const mostConsistent = rankedWithData[0] || null;

  // Active challenge
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const activeChallenge = (challenges || []).find((c) => {
    if (!c.is_active || c.group_id !== group.id) return false;
    try {
      const end = parseISO(c.end_date);
      const start = parseISO(c.start_date);
      return !isAfter(start, now) && !isAfter(now, end);
    } catch { return false; }
  });

  const challengeDaysRemaining = activeChallenge
    ? Math.max(0, Math.ceil((parseISO(activeChallenge.end_date) - now) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={onBack} aria-label="Back to group">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="font-bold text-base">{group.name}</h2>
          <p className="text-xs text-muted-foreground">Week of {weekLabel}</p>
        </div>
      </div>

      {/* Completion rate vs previous week */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Last Week" value={`${thisWeekRate}%`} sub="completion rate" highlight />
        <div className="rounded-xl bg-muted/60 p-4 flex flex-col justify-between">
          <p className="text-xs text-muted-foreground font-medium">vs. Week Before</p>
          <div className="flex items-center gap-2 mt-2">
            <TrendIcon diff={rateDiff} />
            <span className={cn("text-xl font-bold", rateDiff > 0 ? "text-primary" : rateDiff < 0 ? "text-destructive" : "text-foreground")}>
              {rateDiff > 0 ? "+" : ""}{rateDiff}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{prevWeekRate}% prev. week</p>
        </div>
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-2 gap-3">
        {mostImproved && (
          <div className="rounded-xl bg-accent/10 ring-1 ring-accent/20 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-accent" />
              <p className="text-xs font-semibold text-accent">Most Improved</p>
            </div>
            <p className="text-sm font-bold truncate">{mostImproved.name}</p>
            <p className="text-xs text-muted-foreground">
              {mostImproved.improvement > 0 ? `+${mostImproved.improvement}%` : "—"} vs prev week
            </p>
          </div>
        )}
        {mostConsistent && (
          <div className="rounded-xl bg-primary/5 ring-1 ring-primary/20 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-primary" />
              <p className="text-xs font-semibold text-primary">Most Consistent</p>
            </div>
            <p className="text-sm font-bold truncate">{mostConsistent.name}</p>
            <p className="text-xs text-muted-foreground">{mostConsistent.thisWeek}% this week</p>
          </div>
        )}
      </div>

      {/* Member Rankings */}
      <Card className="border-0 shadow-sm p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Member Rankings: Last Week</p>
        {rankings.map((m, i) => (
          <div key={m.email} className={cn(
            "flex items-center gap-3 p-2 rounded-xl",
            m.email === userEmail ? "bg-primary/5 ring-1 ring-primary/20" : i < 3 ? "bg-muted/50" : ""
          )}>
            <span className="text-xs font-bold text-muted-foreground w-5 text-center">#{i + 1}</span>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {m.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {m.name} {m.email === userEmail && <span className="text-xs text-primary font-normal">(you)</span>}
              </p>
              {m.hasData ? (
                <p className="text-xs text-muted-foreground">{m.thisWeek}% completion</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">No data yet</p>
              )}
            </div>
            {m.hasData && (
              <div className="flex items-center gap-1 shrink-0">
                <TrendIcon diff={m.improvement} />
                <span className={cn("text-xs font-medium", m.improvement > 0 ? "text-primary" : m.improvement < 0 ? "text-destructive" : "text-muted-foreground")}>
                  {m.improvement > 0 ? `+${m.improvement}` : m.improvement}%
                </span>
              </div>
            )}
          </div>
        ))}
      </Card>

      {/* Top habit -- genuinely group-wide (see getGroupTopHabitLastWeek);
          this used to only ever show the viewer's own top habit,
          mislabeled as if it were the group's */}
      {groupTopHabit && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium">Highest Group Completion</p>
            <p className="text-sm font-bold truncate">{groupTopHabit.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {getDisplayName(groupTopHabit.email, profiles)}
              {groupTopHabit.email === userEmail && " (you)"}
            </p>
          </div>
          <span className="text-lg font-bold text-accent shrink-0">
            {groupTopHabit.count}×
          </span>
        </div>
      )}

      {/* Active challenge */}
      {activeChallenge && (
        <div className="rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 to-primary/10 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-accent" />
              <div>
                <p className="text-sm font-semibold">{activeChallenge.habit_name}</p>
                <p className="text-xs text-muted-foreground">Active challenge</p>
              </div>
            </div>
            <span className="text-xs bg-accent/20 text-accent font-semibold px-2 py-0.5 rounded-full">
              {challengeDaysRemaining}d left
            </span>
          </div>
        </div>
      )}
    </div>
  );
}