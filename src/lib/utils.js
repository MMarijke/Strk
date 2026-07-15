import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, subDays } from "date-fns";
import { calculateStreak } from "@/components/habits/StreakWidget";

export function calculateScore(habits) {
  if (!habits || !habits.length) return 0;
  const last30 = Array.from({ length: 30 }, (_, i) =>
    format(subDays(new Date(), i), "yyyy-MM-dd")
  );
  const consistency = Math.round(
    habits.reduce((s, h) => {
      const c = h.completions|| [];
      return s + Math.round((last30.filter((d) => c.includes(d)).length / 30) * 100);
    }, 0) / habits.length
  );
  const bestStreak = Math.max(
    ...habits.map((h) => calculateStreak(h.completions || [])), 0
  );
  return bestStreak * 2 + consistency;
}

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 

export const isIframe = window.self !== window.top;

// ── RPG Rank System ──────────────────────────────────────────────────────────
export const RANKS = [
  { key: "ember",   title: "Ember",   emoji: "🌱", minScore: 0,   maxScore: 49,  color: "green" },
  { key: "flame",   title: "Flame",   emoji: "🔥", minScore: 50,  maxScore: 99,  color: "orange" },
  { key: "blaze",   title: "Blaze",   emoji: "⚡", minScore: 100, maxScore: 199, color: "yellow" },
  { key: "inferno", title: "Inferno", emoji: "🌋", minScore: 200, maxScore: 399, color: "red" },
  { key: "legend",  title: "Legend",  emoji: "👑", minScore: 400, maxScore: Infinity, color: "gold" },
];

export function getRank(score) {
  const s = Math.max(0, score);
  const idx = RANKS.findLastIndex((r) => s >= r.minScore);
  const rank = RANKS[idx] ?? RANKS[0];
  const nextRank = RANKS[idx + 1] ?? null;
  return { ...rank, nextRank };
}