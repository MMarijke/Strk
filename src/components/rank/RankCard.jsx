import React from "react";
import { getRank } from "@/lib/utils";

// A colored zero-offset box-shadow ("glow") reads as a soft, low-contrast
// halo on a near-black background instead of standing out -- there's no
// real depth without an offset. This card earns its presence instead
// through a genuine elevated shadow (offset + blur, not colored), a
// solid rank-colored border, a tinted background wash, and a progress
// bar tied to the rank's own color instead of a generic primary fill.
const RANK_STYLES = {
  green:  { border: "border-green-500/40",  tint: "from-green-500/15",  bar: "bg-green-500" },
  orange: { border: "border-orange-500/40", tint: "from-orange-500/15", bar: "bg-orange-500" },
  yellow: { border: "border-yellow-500/40", tint: "from-yellow-500/15", bar: "bg-yellow-500" },
  red:    { border: "border-red-500/40",    tint: "from-red-500/15",   bar: "bg-red-500" },
  gold:   { border: "border-yellow-400/60", tint: "from-yellow-400/20", bar: "bg-gradient-to-r from-yellow-400 to-amber-500" },
};

export default function RankCard({ score }) {
  const rank = getRank(score);
  const { nextRank } = rank;
  const style = RANK_STYLES[rank.color] ?? RANK_STYLES.green;

  const progressPct = nextRank
    ? Math.min(((score - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100, 100)
    : 100;

  const pointsLeft = nextRank ? nextRank.minScore - score : 0;

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br ${style.tint} to-card shadow-lg shadow-black/20 p-4 transition-all duration-500 ${style.border}`}
    >
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
          className={`h-full rounded-full transition-all duration-700 ${style.bar}`}
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