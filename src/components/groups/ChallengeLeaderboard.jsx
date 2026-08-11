import React from "react";
import { Habit } from "@/api/entities";
import { useQueries } from "@tanstack/react-query";
import { format, parseISO, eachDayOfInterval, differenceInDays, isAfter } from "date-fns";
import { Crown, Medal, Flame, Trophy } from "lucide-react";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { cn } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import ChallengeCompleteScreen from "./ChallengeCompleteScreen";

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-muted-foreground" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
  return <span className="text-xs font-bold text-muted-foreground w-4 text-center">#{rank}</span>;
}

function getStatsForMember(challenge, habits) {
  const startDate = parseISO(challenge.start_date);
  const endDate = parseISO(challenge.end_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const effectiveEnd = isAfter(today, endDate) ? endDate : today;
  const elapsedDays = differenceInDays(effectiveEnd, startDate) + 1;

  const allDays = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
    format(d, "yyyy-MM-dd")
  );
  const elapsedDates = allDays.slice(0, Math.max(elapsedDays, 0));

  const matchingHabit = habits.find(
    (h) => h.name.toLowerCase() === challenge.habit_name.toLowerCase()
  );

  if (!matchingHabit) {
    return { completedDays: 0, pct: 0, streak: 0, elapsedDays, noMatchingHabit: true };
  }

  const completions = matchingHabit.completions || [];
  const challengeCompletions = completions.filter(
    (d) => d >= challenge.start_date && d <= challenge.end_date
  );

  const completedDays = elapsedDates.filter((d) => completions.includes(d)).length;
  const pct = elapsedDays > 0 ? Math.round((completedDays / elapsedDays) * 100) : 0;
  const streak = calculateStreak(challengeCompletions);

  return { completedDays, pct, streak, elapsedDays, noMatchingHabit: false };
}

export default function ChallengeLeaderboard({ challenge, habits: myHabits, userEmail, profiles = [], onStartNew, isAdmin }) {
  const startDate = parseISO(challenge.start_date);
  const endDate = parseISO(challenge.end_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isEnded = isAfter(today, endDate);
  const totalDays = challenge.duration_days;
  const daysElapsed = Math.min(differenceInDays(today, startDate) + 1, totalDays);
  const daysRemaining = Math.max(totalDays - daysElapsed, 0);
  const progressPct = Math.round((daysElapsed / totalDays) * 100);

  const members = challenge.member_emails || [];
  const otherMembers = members.filter((e) => e !== userEmail);

  // Fetch habits for all other members in parallel
  const memberHabitQueries = useQueries({
    queries: otherMembers.map((email) => ({
      queryKey: ["habits", email],
      queryFn: () => Habit.filter({ created_by: email }, "-created_date"),
      staleTime: 30_000,
    })),
  });

  const isLoading = memberHabitQueries.some((q) => q.isLoading);

  // Build rows with real data for everyone
  const rows = members.map((email) => {
    const isMe = email === userEmail;
    const habits = isMe
      ? myHabits
      : (memberHabitQueries[otherMembers.indexOf(email)]?.data || []);
    const stats = getStatsForMember(challenge, habits);
    return {
      email,
      name: getDisplayName(email, profiles),
      isMe,
      ...stats,
    };
  }).sort((a, b) => b.pct - a.pct || b.streak - a.streak || b.completedDays - a.completedDays);

  const myStats = getStatsForMember(challenge, myHabits);
  const myRank = rows.findIndex((r) => r.isMe) + 1;
  const groupCompletionRate = Math.round(rows.reduce((s, r) => s + r.pct, 0) / Math.max(rows.length, 1));

  if (isEnded) {
    return (
      <ChallengeCompleteScreen
        challenge={challenge}
        rows={rows}
        groupCompletionRate={groupCompletionRate}
        isAdmin={isAdmin}
        onStartNew={onStartNew}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Challenge header */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <Trophy className="w-3.5 h-3.5 text-accent" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Challenge</p>
            </div>
            <p className="font-bold text-base text-foreground">{challenge.habit_name}</p>
            <p className="text-xs font-medium text-primary mt-0.5">Tracking: {challenge.habit_name}</p>
            {challenge.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{challenge.description}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-foreground">{daysRemaining}</p>
            <p className="text-[10px] text-muted-foreground">days left</p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Day {daysElapsed} of {totalDays}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* My quick stats */}
        <div className="flex gap-3 pt-1">
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">{myStats.pct}%</p>
            <p className="text-[10px] text-muted-foreground">My completion</p>
          </div>
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">{myStats.streak}</p>
            <p className="text-[10px] text-muted-foreground">Current streak</p>
          </div>
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">#{myRank}</p>
            <p className="text-[10px] text-muted-foreground">My rank</p>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {challenge.habit_name} · Live Rankings
          </p>
          {isLoading && (
            <span className="text-[10px] text-muted-foreground animate-pulse">Updating…</span>
          )}
        </div>

        {rows.map((row, i) => (
          <div key={row.email} className={cn(
            "flex items-center gap-3 p-2 rounded-xl transition-colors",
            row.isMe ? "bg-primary/5 ring-1 ring-primary/20" : i < 3 ? "bg-muted/40" : ""
          )}>
            <div className="w-6 flex items-center justify-center shrink-0">
              <RankIcon rank={i + 1} />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {row.name[0].toUpperCase()}
            </div>
            {row.noMatchingHabit ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                </p>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  No matching habit. Add "{challenge.habit_name}" to join
                </p>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${row.pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{row.pct}%</span>
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="flex items-center gap-1 justify-end">
                    <Flame className="w-3 h-3 text-accent" />
                    <span className="text-xs font-bold">{row.streak}d</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{row.completedDays}/{row.elapsedDays} days</p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export { getStatsForMember as getChallengeStats };