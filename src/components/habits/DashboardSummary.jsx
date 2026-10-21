import React from "react";
import { format } from "date-fns";
import { Flame, Target, CalendarCheck, CheckCheck } from "lucide-react";
import { bestActiveStreak } from "./StreakWidget";
import { getRank } from "@/lib/utils";
import { getNextRefreshDateStr } from "@/lib/freezeService";

// Merges StatsBar + RankCard + FreezeIndicator (formerly three separate
// stacked blocks) into one compact card -- part of the fix for the
// critique finding that up to 7 chrome blocks rendered above the first
// habit card. Those three components are now unused anywhere else in
// the app (confirmed before removing them) and were retired in favor
// of this one. Styling (rank-colored border/tint/progress-bar) is
// carried over verbatim from the retired RankCard.jsx -- see its own
// comment, preserved here, for why a genuine offset+blur shadow is used
// instead of a colored zero-offset glow.
const RANK_STYLES = {
  green: { border: "border-green-500/40", tint: "from-green-500/15", bar: "bg-green-500" },
  orange: { border: "border-orange-500/40", tint: "from-orange-500/15", bar: "bg-orange-500" },
  yellow: { border: "border-yellow-500/40", tint: "from-yellow-500/15", bar: "bg-yellow-500" },
  red: { border: "border-red-500/40", tint: "from-red-500/15", bar: "bg-red-500" },
  gold: { border: "border-yellow-400/60", tint: "from-yellow-400/20", bar: "bg-gradient-to-r from-yellow-400 to-amber-500" },
};

export default function DashboardSummary({ habits, score, isPro, freezesRemaining, frozenHabits = {}, onCompleteAll }) {
  const rank = getRank(score);
  const { nextRank } = rank;
  const style = RANK_STYLES[rank.color] ?? RANK_STYLES.green;

  const progressPct = nextRank
    ? Math.min(((score - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100, 100)
    : 100;
  const pointsLeft = nextRank ? nextRank.minScore - score : 0;

  const today = format(new Date(), "yyyy-MM-dd");
  const completedToday = habits.filter((h) => (h.completions || []).includes(today)).length;
  const totalHabits = habits.length;
  // Was an inline reduce that called calculateStreak without each habit's
  // frozen date, so a streak held together by a streak freeze broke at the
  // frozen day: the same habit read 23 days on its own card, which has
  // always passed frozenDate, and 18 here. Same completions, one argument
  // apart. The card was right.
  //
  // Also renamed from longestStreak, which this never was: calculateStreak
  // returns the CURRENT active run. The label below said "best", claiming a
  // record it had not measured -- anyone whose best-ever run exceeded their
  // current one was shown a smaller number and told it was their best.
  const streak = bestActiveStreak(habits, frozenHabits);
  const allDone = totalHabits > 0 && completedToday === totalHabits;

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br ${style.tint} to-card shadow-lg shadow-black/20 p-4 transition-all duration-500 ${style.border}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl leading-none">{rank.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base text-foreground leading-tight">{rank.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {score} points
            {nextRank ? ` · ${pointsLeft} to ${nextRank.emoji} ${nextRank.title}` : " · Maximum rank 👑"}
          </p>
        </div>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all duration-700 ${style.bar}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground border-t border-border/60 pt-3">
        <span className="flex items-center gap-1.5">
          <CalendarCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          {completedToday}/{totalHabits} today
        </span>
        <span className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-chart-3" aria-hidden="true" />
          {totalHabits} habit{totalHabits !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
          {streak}-day streak
        </span>
        {freezesRemaining !== null && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">❄️</span>
            {isPro
              ? "Unlimited freezes"
              : freezesRemaining > 0
              ? `${freezesRemaining} freeze${freezesRemaining !== 1 ? "s" : ""}`
              : `resets ${getNextRefreshDateStr()}`}
          </span>
        )}
        {/* Formerly its own full-width bordered-button block between this
            card and the habit list -- demoted to a plain text action
            folded into the existing stats row instead of a dedicated
            chrome block, per the critique's chrome-density finding.
            flex-wrap on the row means it drops to its own line rather
            than overflowing if the other stats don't leave room. */}
        {!allDone && onCompleteAll && (
          <button
            type="button"
            onClick={onCompleteAll}
            className="flex items-center gap-1.5 text-primary font-medium hover:underline ml-auto"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            Complete all
          </button>
        )}
      </div>
    </div>
  );
}
