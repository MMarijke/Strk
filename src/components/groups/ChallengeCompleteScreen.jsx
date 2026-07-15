import React, { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Crown, Medal, RotateCcw, List, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-muted-foreground" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
  return <span className="text-xs font-bold text-muted-foreground w-4 text-center">#{rank}</span>;
}

export default function ChallengeCompleteScreen({ challenge, rows, groupCompletionRate, isAdmin, onStartNew }) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const fired = useRef(false);

  const winner = rows[0];

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 6,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#f59e0b", "#10b981", "#6366f1"],
      });
      confetti({
        particleCount: 6,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#f59e0b", "#10b981", "#6366f1"],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  return (
    <div className="space-y-4">
      {/* Hero banner */}
      <div className="rounded-2xl bg-gradient-to-br from-yellow-400/20 via-accent/15 to-primary/15 border border-yellow-400/30 p-6 text-center space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Challenge Complete 🎉</p>

        <div className="text-6xl animate-bounce">🏆</div>

        {/* Winner avatar */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-accent flex items-center justify-center text-2xl font-bold text-white shadow-lg ring-4 ring-yellow-400/40">
            {(winner?.name || "?")[0].toUpperCase()}
          </div>
          <p className="font-bold text-xl text-foreground mt-1">{winner?.name}</p>
          <p className="text-sm text-muted-foreground">🥇 Challenge Winner</p>
          <div className="flex items-center gap-1 mt-1 bg-accent/10 rounded-full px-3 py-0.5">
            <Flame className="w-3.5 h-3.5 text-accent" />
            <span className="text-sm font-semibold text-accent">{winner?.pct}% completion</span>
          </div>
        </div>

        {/* Group stat */}
        <div className="mt-3 pt-4 border-t border-yellow-400/20 grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-bold text-foreground">{groupCompletionRate}%</p>
            <p className="text-[11px] text-muted-foreground">Group completion</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{challenge.duration_days}d</p>
            <p className="text-[11px] text-muted-foreground">Challenge length</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="gap-2 rounded-xl h-11"
          onClick={() => setShowLeaderboard((v) => !v)}
        >
          <List className="w-4 h-4" />
          {showLeaderboard ? "Hide Results" : "View Results"}
        </Button>
        {isAdmin && (
          <Button className="gap-2 rounded-xl h-11" onClick={onStartNew}>
            <RotateCcw className="w-4 h-4" />
            New Challenge
          </Button>
        )}
      </div>

      {/* Full leaderboard (collapsible) */}
      {showLeaderboard && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Final Standings</p>
          {rows.map((row, i) => (
            <div
              key={row.email}
              className={cn(
                "flex items-center gap-3 p-2 rounded-xl",
                i === 0 ? "bg-yellow-400/10 ring-1 ring-yellow-400/30" :
                row.isMe ? "bg-primary/5 ring-1 ring-primary/20" :
                i < 3 ? "bg-muted/50" : ""
              )}
            >
              <div className="w-6 flex items-center justify-center shrink-0">
                <RankIcon rank={i + 1} />
              </div>
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                i === 0 ? "bg-gradient-to-br from-yellow-400 to-accent text-white" : "bg-primary/20 text-primary"
              )}>
                {(row.name || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{row.completedDays}d done</span>
                </div>
              </div>
              <p className="text-sm font-bold text-foreground shrink-0">{row.pct}%</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}