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

// Whether this viewer has asked the OS for less motion.
//
// index.css's reduced-motion block only reaches CSS animations and
// transitions; a canvas-confetti burst is JavaScript drawing to a canvas, so
// nothing in the stylesheet can quiet it. This project fires four of them
// (RankUpModal, BadgeCelebrationModal, ChallengeCompleteScreen and the focus
// room) and the focus room's 180 particles is the largest. Lives here rather
// than inline so the other three can adopt it without each re-deriving the
// query.
//
// Guarded for the absent-matchMedia case so a test environment or an old
// browser gets the celebration rather than a crash.
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// Shared by Subscription.jsx (a live subscription's price) and
// UpgradeModal.jsx (the live catalog price via usePaddlePrices) -- both
// consume the identical Paddle price-object shape (unit_price: { amount,
// currency_code }), so one implementation instead of two copies that can
// drift out of sync.
export function formatPrice(price) {
  if (!price?.unit_price) return null;
  const amount = Number(price.unit_price.amount) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: price.unit_price.currency_code }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

// Computed from live fetched Paddle prices rather than a hardcoded "25%" --
// exactly the "remembered number" PRODUCT.md says the pricing surface must
// never display, so if the catalog's actual prices ever change (a plan
// price update, a currency-specific override) this recalculates instead of
// silently going stale. Shared by PricingSection, UpgradeModal, and
// Subscription -- was previously duplicated (correctly) in PricingSection
// and hardcoded (incorrectly, three places) elsewhere.
export function annualSavingsPct(monthly, annual) {
  const monthlyCents = Number(monthly?.unit_price?.amount);
  const annualCents = Number(annual?.unit_price?.amount);
  if (!monthlyCents || !annualCents) return null;
  return Math.round((1 - annualCents / (monthlyCents * 12)) * 100);
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

// Same order as HABIT_COLORS -- lets the color-picker swatches (AddHabitDialog,
// EditHabitModal) give each one a real accessible name instead of a screen
// reader hearing an unlabeled "button" per swatch.
export const HABIT_COLOR_NAMES = [
  "Amber",
  "Gold",
  "Sage",
  "Slate Blue",
  "Lavender",
  "Rose",
  "Teal",
  "Terracotta",
];

// ── RPG Rank System ──────────────────────────────────────────────────────────
export const RANKS = [
  { key: "ember",   title: "Ember",   emoji: "🌱", minScore: 0,   maxScore: 49,  color: "green" },
  { key: "flame",   title: "Flame",   emoji: "🔥", minScore: 50,  maxScore: 99,  color: "orange" },
  { key: "blaze",   title: "Blaze",   emoji: "⚡", minScore: 100, maxScore: 199, color: "yellow" },
  { key: "inferno", title: "Inferno", emoji: "🌋", minScore: 200, maxScore: 399, color: "red" },
  { key: "legend",  title: "Legend",  emoji: "👑", minScore: 400, maxScore: Infinity, color: "gold" },
];

// Standard competition ranking ("1-2-2-4"): equal scores share a place, and
// the next distinct score skips the places the tie consumed.
//
// Both leaderboards previously ranked by array index, so two people with an
// identical score got different places -- one a crown, the other a silver
// medal -- decided by whatever order the rows arrived in. On this product
// that is not a cosmetic detail: the score is the whole point of the
// screen, and awarding one of two equal performances a lower place is
// simply wrong, in a way a user can notice by reading two adjacent rows.
//
// Expects `entries` already sorted by score, descending. Returns new
// objects (never mutates) carrying `rank` and `isTied`.
//
// A non-numeric score -- GroupDashboard uses `score: null` for a member
// whose profile isn't readable -- still gets a position so the list keeps
// counting, but is never reported as tied: two members who share nothing
// but the absence of data have not tied with each other.
export function assignCompetitionRanks(entries) {
  let prevScore;
  let prevRank = 0;

  const ranked = entries.map((entry, i) => {
    const comparable = typeof entry.score === "number";
    const rank = comparable && i > 0 && entry.score === prevScore ? prevRank : i + 1;
    prevScore = comparable ? entry.score : undefined;
    prevRank = rank;
    return { ...entry, rank };
  });

  const seen = new Set();
  const shared = new Set();
  for (const entry of ranked) {
    if (typeof entry.score !== "number") continue;
    if (seen.has(entry.rank)) shared.add(entry.rank);
    seen.add(entry.rank);
  }

  return ranked.map((entry) => ({
    ...entry,
    isTied: typeof entry.score === "number" && shared.has(entry.rank),
  }));
}

// "1st" / "2nd" / "23rd" -- for the accessible name on a rank, which has
// to read as a place rather than as a bare digit next to an unlabelled
// medal icon.
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

export function getRank(score) {
  const s = Math.max(0, score);
  const idx = RANKS.findLastIndex((r) => s >= r.minScore);
  const rank = RANKS[idx] ?? RANKS[0];
  const nextRank = RANKS[idx + 1] ?? null;
  return { ...rank, nextRank };
}