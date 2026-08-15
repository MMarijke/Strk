import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, subDays } from "date-fns";

// Longest-ever run of consecutive-day completions, not just the current
// active one -- moved here (from MilestoneBadges.jsx, which now imports it
// back) so calculateScore below can use the same definition of "best
// streak" the leaderboards and the server-side habits_sync_profile_stats
// trigger already use, instead of pointing lib/utils.js at a component
// file (MilestoneBadges.jsx itself imports cn from here, so the reverse
// direction would be a real import cycle).
export function getAllTimeBest(completions) {
  if (!completions || completions.length === 0) return 0;
  const sorted = [...completions].sort();
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00");
    const curr = new Date(sorted[i] + "T00:00:00");
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) { cur++; best = Math.max(best, cur); }
    else if (diff > 1) cur = 1;
  }
  return best;
}

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
  // All-time-best, not current active streak -- matches the definition
  // leaderboards (Social.jsx, GroupDashboard.jsx) and the server-synced
  // user_profiles.best_streak column already use, so a user's own rank
  // reads the same everywhere instead of disagreeing with itself.
  const bestStreak = Math.max(
    ...habits.map((h) => getAllTimeBest(h.completions || [])), 0
  );
  return bestStreak * 2 + consistency;
}

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 

export const isIframe = window.self !== window.top;

// Shared across HabitCard, AddHabitDialog, EditHabitModal (color picker)
// and Trends (chart line stroke, imported there as STROKE_COLORS) --
// previously duplicated as two separate literal arrays that happened to
// stay in sync by luck rather than by construction.
export const HABIT_COLORS = [
  "#E8A030",
  "#F5C265",
  "#7A9E78",
  "#6B8FAB",
  "#9B8BB5",
  "#C47A8A",
  "#7AB5A8",
  "#D4956A",
];

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