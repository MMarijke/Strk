import React from "react";
import { cn, getAllTimeBest } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const MILESTONES = [
  { days: 3,   emoji: "🌱", label: "Seedling",    desc: "3-day streak" },
  { days: 7,   emoji: "🔥", label: "On Fire",     desc: "7-day streak" },
  { days: 14,  emoji: "⚡", label: "Charged",     desc: "14-day streak" },
  { days: 30,  emoji: "🏆", label: "Champion",    desc: "30-day streak" },
  { days: 60,  emoji: "💎", label: "Diamond",     desc: "60-day streak" },
  { days: 100, emoji: "🚀", label: "Legendary",   desc: "100-day streak" },
];

export default function MilestoneBadges({ completions = [], currentStreak = 0 }) {
  const bestEver = getAllTimeBest(completions);
  const best = Math.max(bestEver, currentStreak);

  const earned = MILESTONES.filter((m) => best >= m.days);
  if (earned.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {earned.map((m) => (
          <Tooltip key={m.days}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-sm cursor-default",
                  "bg-muted hover:scale-125 transition-transform duration-200"
                )}
                title={m.label}
              >
                {m.emoji}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold">{m.label}</p>
              <p className="text-muted-foreground">{m.desc}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export { MILESTONES, getAllTimeBest };