import React from "react";
import { getRank } from "@/lib/utils";

const GLOW_COLORS = {
  green:  "shadow-[0_0_24px_4px_rgba(34,197,94,0.25)]  border-green-400/30",
  orange: "shadow-[0_0_24px_4px_rgba(249,115,22,0.25)] border-orange-400/30",
  yellow: "shadow-[0_0_24px_4px_rgba(234,179,8,0.25)]  border-yellow-400/30",
  red:    "shadow-[0_0_24px_4px_rgba(239,68,68,0.25)]  border-red-400/30",
  gold:   "shadow-[0_0_24px_4px_rgba(234,179,8,0.40)]  border-yellow-300/50",
};

export default function RankCard({ score }) {
  const rank = getRank(score);
  const { nextRank } = rank;

  const progressPct = nextRank
    ? Math.min(((score - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100, 100)
    : 100;

  const pointsLeft = nextRank ? nextRank.minScore - score : 0;

  return (
    <div className={`rounded-2xl border bg-card p-4 transition-all duration-500 ${GLOW_COLORS[rank.color] ?? ""}`}>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl leading-none">{rank.emoji}</span>
        <div>
          <p className="font-bold text-base text-foreground leading-tight">{rank.title}</p>
          <p className="text-xs text-muted-foreground">{score} points</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {nextRank
          ? `${pointsLeft} points to ${nextRank.emoji} ${nextRank.title}`
          : "Maximum rank reached 👑"}
      </p>
    </div>
  );
}