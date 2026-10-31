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
/**
 * A "yyyy-MM-dd" string as a whole number of days, for comparing dates.
 *
 * This exists because the obvious way to ask "are these two dates one day
 * apart" is wrong twice a year. `new Date("2026-11-02T00:00:00")` parses
 * as LOCAL midnight, and local midnights are not 24 hours apart across a
 * DST transition -- so `(b - a) / 86400000` returns 1.0417 at fall-back
 * and 0.9583 at spring-forward, and an `=== 1` test fails on a run of
 * consecutive days that really is consecutive.
 *
 * Measured, scanning every day boundary of 2026: every DST-observing zone
 * has exactly two broken boundaries a year.
 *
 *   America/*     2026-03-08 -> 03-09   and   2026-11-01 -> 11-02
 *   Europe/*      2026-03-29 -> 03-30   and   2026-10-25 -> 10-26
 *   Australia/*   2026-04-05 -> 04-06   and   2026-10-04 -> 10-05
 *   Africa/Johannesburg, Asia/Kolkata, America/Sao_Paulo:  none
 *
 * That last line is why this went unnoticed: the timezone this is
 * developed in has no DST, so it never reproduces locally.
 *
 * Date.UTC never applies an offset, so every day is exactly 86400000ms
 * and the result is an integer, independent of the viewer's timezone. NaN
 * for an unparseable string, which every caller treats as a break in the
 * run -- the same thing the old Invalid Date arithmetic did, minus the
 * crash risk.
 */
export function dayNumber(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function getAllTimeBest(completions) {
  if (!completions || completions.length === 0) return 0;
  const sorted = [...completions].sort();
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    // Integer day arithmetic, not Date subtraction -- see dayNumber.
    // A fall-back boundary used to read as diff > 1 and RESET cur to 1,
    // silently truncating an all-time best streak; best_streak is then
    // weighted x2 in the score and gates six badges.
    const diff = dayNumber(sorted[i]) - dayNumber(sorted[i - 1]);
    if (diff === 1) { cur++; best = Math.max(best, cur); }
    else if (diff > 1) cur = 1;
  }
  return best;
}

/**
 * The one definition of a user's score, matching
 * sync_profile_stats_from_habits (20261025090002) field for field so a
 * user's own numbers agree with the ones other people are shown.
 *
 * Archived habits are treated differently per stat, deliberately:
 *
 *   - bestStreak counts EVERY habit. It is the all-time best, and
 *     excluding retired habits would retroactively erase a record
 *     somebody actually set.
 *   - consistency counts only habits still being tracked. It averages a
 *     30-day rate across habits, so an archived habit contributes 0% and
 *     drags the average down -- retiring a habit you had already stopped
 *     doing used to lower your score.
 *
 * The filtering happens HERE rather than in callers. It used to be the
 * caller's job and that is precisely how this drifted: Dashboard passed
 * habits it had already filtered (src/pages/Dashboard.jsx), while Badges,
 * Social and GroupDashboard passed everything -- so the same function gave
 * one user two different scores on two screens, under a comment claiming
 * it read the same everywhere. Pass the full list; this decides.
 */
/**
 * How many days a habit has existed, capped at `maxDays`.
 *
 * This is the denominator for that habit's completion rate, and it exists
 * because a fixed 30 punishes the single action the product most wants.
 * A habit created today and completed today was kept 1 day out of 1 — but
 * divided by 30 it reads 3.33%, and since consistency averages across
 * habits, adding one to a perfect 50-day habit used to drop consistency
 * from 100% to 52% and the score from 200 to 152: a full tier, silently,
 * as the immediate consequence of tracking something new.
 *
 * Inclusive of the creation day, so a habit created today has a window of
 * 1 rather than 0 — a 0 would divide by zero.
 *
 * Returns `maxDays` when the creation date is missing or unparseable,
 * which is the old behaviour: an unknown age must not inflate a rate.
 * Clamped to at least 1 so clock skew (a creation date in the future)
 * cannot produce a negative or zero window.
 */
export function habitWindowDays(habit, asOf = new Date(), maxDays = 30) {
  const raw = habit?.created_date ?? habit?.created_at;
  if (!raw) return maxDays;

  const created = new Date(raw);
  if (Number.isNaN(created.getTime())) return maxDays;

  const age = dayNumber(format(asOf, "yyyy-MM-dd")) - dayNumber(format(created, "yyyy-MM-dd")) + 1;
  if (!Number.isFinite(age)) return maxDays;
  return Math.max(1, Math.min(maxDays, age));
}

export function calculateStats(habits, asOf = new Date(), witness = 0) {
  const all = habits || [];
  if (!all.length) {
    return { score: 0, base: 0, bestStreak: 0, rollingBest: 0, consistency: 0, witness };
  }

  const active = all.filter((h) => !h.archived);
  const last30 = Array.from({ length: 30 }, (_, i) =>
    format(subDays(asOf, i), "yyyy-MM-dd")
  );
  // Nothing after asOf counts, so the same function can answer "what was
  // this score a week ago" -- which is what ScoreHistoryChart needs, and
  // why it no longer has its own copy of this arithmetic. For the default
  // asOf this filter is a no-op: reject_future_habit_completions
  // (20260914090005) already prevents a completion dated ahead of today.
  const cutoff = format(asOf, "yyyy-MM-dd");

  // Rounded ONCE, at the end.
  //
  // This used to round each habit's percentage and then round the average
  // of those, while the server rounds only the average -- `round(avg(pct))`
  // in sync_profile_stats_from_habits. Double rounding disagrees with
  // single rounding for 220 of the 961 possible two-habit combinations.
  // Two habits with 0 and 2 completions in the window: the server says 3%,
  // this used to say 4%.
  //
  // One point sounds harmless, and is not, because of where the two
  // numbers meet. Every leaderboard draws YOUR row from this function and
  // everyone else's from user_profiles.consistency_score, which the
  // trigger wrote. The viewer was therefore ranked against the field by a
  // formula that differed from the one applied to the field.
  const consistency = active.length
    ? Math.round(
      active.reduce((s, h) => {
        const c = h.completions || [];
        // Each habit is rated over its own lifetime, capped at 30 days --
        // see habitWindowDays. Slicing the window rather than clamping the
        // result also handles a case this app genuinely produces:
        // completions can PREDATE created_date, because Edit Completions
        // lets a user backfill (SmartReminders.jsx records the same).
        // Counting those against a 1-day window would read 500%; taking
        // only the window's own days means the count can never exceed it.
        const w = habitWindowDays(h, asOf);
        return s + (last30.slice(0, w).filter((d) => c.includes(d)).length / w) * 100;
      }, 0) / active.length
    )
    : 0;

  const withinCutoff = (h) => (h.completions || []).filter((d) => d <= cutoff);

  // All-time, across every habit including archived. No longer the score's
  // input -- it is the PEAK record, kept because it is a record somebody
  // set and because the six streak badges legitimately read it.
  const bestStreak = Math.max(...all.map((h) => getAllTimeBest(withinCutoff(h))), 0);

  // The score's form term. Archived habits are included for the same
  // reason the SQL includes them: this measures whether the user actually
  // showed up on those days, a historical fact about the window, so
  // retiring the habit afterwards should not erase them. The decay is the
  // window moving on, not the archive flag.
  const rolling = Math.max(...all.map((h) => rollingBest(withinCutoff(h), asOf)), 0);

  const base = rolling * 2 + consistency;

  return {
    score: scoreFromParts(rolling, consistency, witness),
    base,
    bestStreak,
    rollingBest: rolling,
    consistency,
    witness,
  };
}

/**
 * The score weighting, in one place.
 *
 * `bestStreak * 2 + consistency` was written out in five files besides
 * this one -- GroupDashboard, ScoreHistoryChart, Badges and Social twice.
 * calculateStats owned it only for the viewer's own row; every "other
 * person" row re-derived it from the server columns. Changing the
 * weighting meant editing six files and noticing all six.
 *
 * Takes the parts rather than habits because the other-person callers
 * genuinely only have the parts: user_profiles.best_streak and
 * .consistency_score, computed server-side. That asymmetry is the point of
 * the function.
 */
export function scoreFromParts(rollingBest, consistency, witness = 0) {
  const base = (rollingBest || 0) * 2 + (consistency || 0);
  return Math.round(base * (1 + (witness || 0)));
}

/**
 * Longest unbroken run inside the trailing `days` window.
 *
 * This replaces the all-time best as the score's form term, and it is the
 * fix for the defect that mattered most: an all-time best is monotone, so
 * with consistency capped at 100 every user's score was pinned inside
 * [2b, 2b+100] and could not move at all past their peak. It also made
 * demotion below a record's tier impossible, so a dormant ex-champion
 * outranked an active newcomer by 240 points.
 *
 * Mirrors the SQL exactly: `d > current_date - 90 and d <= current_date`,
 * i.e. the 90 days ending today inclusive. A run that began 120 days ago
 * and is still going reads as 90, which is the cap by construction.
 *
 * Rolling rather than the live current streak, deliberately: this app
 * ships two streak freezes a month precisely because people miss days, so
 * a term that collapses to zero on one missed day would contradict the
 * product's own acknowledgement. This decays over three months instead.
 */
export function rollingBest(completions, asOf = new Date(), days = 90) {
  const newest = dayNumber(format(asOf, "yyyy-MM-dd"));
  const oldest = newest - (days - 1);
  const within = (completions || []).filter((d) => {
    const n = dayNumber(d);
    return Number.isFinite(n) && n >= oldest && n <= newest;
  });
  return getAllTimeBest(within);
}

/**
 * Score only, for callers that need nothing else.
 *
 * `witness` is second because it is the argument callers actually pass;
 * asOf stays last and defaulted, since only ScoreHistoryChart overrides it.
 */
export function calculateScore(habits, witness = 0, asOf = new Date()) {
  return calculateStats(habits, asOf, witness).score;
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
/**
 * The ladder, re-derived for a bounded score.
 *
 * The old thresholds (0/50/100/200/400) were set against an unbounded
 * score, because the form term was an all-time best streak that could grow
 * forever. It no longer can: rollingBest90 caps at 90, so the base caps at
 * 90*2 + 100 = 280, and the witness multiplier caps at 1.5x, so the score
 * caps at 420. A finite range means these can be spaced deliberately
 * instead of guessed.
 *
 * Wildfire starts at 300 and the SOLO ceiling is 280. That ten-tier-point
 * gap is the whole design: a user with no social activity climbs four full
 * tiers and tops out one short of the fifth, with no lockout rule and no
 * "you need friends" error anywhere -- the arithmetic does it. Move either
 * number without the other and the top tier becomes either reachable alone
 * or unreachable for everyone. See the shape brief.
 *
 * Pacing, one habit never missed: Flame day 12, Blaze day 25, Inferno day
 * 55 solo (day 31 with people), Wildfire day 66 with people. The old
 * ladder was 10/19/50/150, which front-loaded two rank-ups into three
 * weeks and then put the top 150 flawless days away.
 *
 * "Legend" became "Wildfire" because it was the one non-fire word in a
 * fire ladder -- the naming was the only authored thing in the old system
 * -- and because wildfire is the fire state that SPREADS TO OTHER PEOPLE,
 * which is exactly what the multiplier measures. The name and the mechanic
 * finally say the same thing.
 *
 * The emoji and colour fields are unchanged here and are wrong on purpose
 * for now: Ember is still a green seedling and Blaze a lightning bolt in a
 * flame-branded product. Replacing them with one mark at five intensities,
 * and the ramp with monotone ember-to-white-hot theme tokens, is the next
 * change -- doing it here would mix a formula migration with a visual one.
 */
export const RANKS = [
  { key: "ember",    title: "Ember",    emoji: "🌱", minScore: 0,   maxScore: 59,  color: "green" },
  { key: "flame",    title: "Flame",    emoji: "🔥", minScore: 60,  maxScore: 129, color: "orange" },
  { key: "blaze",    title: "Blaze",    emoji: "⚡", minScore: 130, maxScore: 209, color: "yellow" },
  { key: "inferno",  title: "Inferno",  emoji: "🌋", minScore: 210, maxScore: 299, color: "red" },
  { key: "wildfire", title: "Wildfire", emoji: "🔥", minScore: 300, maxScore: Infinity, color: "gold" },
];

/** Tier keys in ladder order. Derived, so nothing can duplicate it. */
export const RANK_ORDER = RANKS.map((r) => r.key);

/**
 * Tier keys that no longer exist, mapped to what replaced them.
 *
 * user_profiles.highest_rank stores a key, so every row written before the
 * rename holds 'legend'. A migration rewrites the column, but this has to
 * exist anyway: an unmapped key makes RANK_ORDER.indexOf return -1, which
 * reads as "no tier ever reached" and would re-fire the rank-up
 * celebration for somebody who peaked years ago.
 */
const LEGACY_RANK_KEYS = { legend: "wildfire" };

export function normalizeRankKey(key) {
  if (!key) return key;
  return LEGACY_RANK_KEYS[key] ?? key;
}

/**
 * The five ways a user's habits can be witnessed, each worth +10%.
 *
 * Distinct KINDS, never volume: volume is farmable (two users could spam
 * reactions at each other) while breadth is not, because each slot is a
 * different feature with a different other person in it. Written by
 * recompute_witness_slots (20261031090002) into user_profiles.witness_slots.
 */
export const WITNESS_SLOTS = [
  { key: "reacted", label: "Reacted to", hint: "Someone responded to your progress" },
  { key: "session", label: "Shared a session", hint: "You focused alongside someone" },
  { key: "challenge", label: "In a challenge", hint: "You're carrying a group challenge" },
  { key: "assist", label: "Saved a streak", hint: "You spent a freeze on someone else" },
  { key: "partner", label: "Accountable", hint: "You have an active partner" },
];

export const WITNESS_SLOT_VALUE = 0.1;

/**
 * 0 to 0.5, from the stored slots.
 *
 * Tolerant of a missing or malformed column on purpose. witness_slots
 * defaults to '{}' for a row the trigger has not reached yet, and a user
 * who has never been witnessed is indistinguishable from one who has never
 * been computed -- both correctly score 0 here. Unknown keys are ignored
 * rather than counted, so adding a slot to the database before the client
 * knows about it cannot inflate anyone's score.
 */
export function witnessFactor(slots) {
  if (!slots || typeof slots !== "object") return 0;
  const lit = WITNESS_SLOTS.filter((s) => slots[s.key] === true).length;
  return lit * WITNESS_SLOT_VALUE;
}

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
/**
 * Filename for a user's data export, stamped with the date it was taken.
 *
 * Lives here rather than beside downloadMyData in exportMyData.js because
 * that module imports supabaseClient, which throws at module scope without
 * env vars -- so anything importing it is untestable. This is the pure
 * half, split out for the same reason partnerNotice.js was.
 *
 * Local time, deliberately not toISOString(). The obvious one-liner
 * (toISOString().slice(0, 10)) is UTC, so an export taken at 8pm in New
 * York would be stamped with tomorrow's date. The file should carry the
 * date the user's own calendar showed.
 */
export function exportFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `strk-my-data-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
