import { format, subDays, getDaysInMonth, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, addDays } from "date-fns";
import { calculateStreak, } from "@/components/habits/StreakWidget";
import { getAllTimeBest } from "@/components/habits/MilestoneBadges";

export const BADGES = [
  {
    id: "first_step",
    emoji: "👟",
    name: "First Step",
    description: "Create your very first habit.",
    color: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
    glow: "shadow-emerald-200",
    category: "milestone",
  },
  {
    id: "on_a_roll",
    emoji: "🌱",
    name: "On a Roll",
    description: "Reach a 3-day streak on any habit.",
    color: "bg-green-100 text-green-700",
    border: "border-green-200",
    glow: "shadow-green-200",
    category: "streak",
    streakDays: 3,
  },
  {
    id: "week_warrior",
    emoji: "🔥",
    name: "Week Warrior",
    description: "Maintain a 7-day streak on any habit.",
    color: "bg-orange-100 text-orange-700",
    border: "border-orange-200",
    glow: "shadow-orange-200",
    category: "streak",
    streakDays: 7,
  },
  {
    id: "fortnight_force",
    emoji: "⚡",
    name: "Fortnight Force",
    description: "Keep a habit going for 14 days straight.",
    color: "bg-yellow-100 text-yellow-700",
    border: "border-yellow-200",
    glow: "shadow-yellow-200",
    category: "streak",
    streakDays: 14,
  },
  {
    id: "monthly_master",
    emoji: "🏆",
    name: "Monthly Master",
    description: "Achieve a 30-day streak on any habit.",
    color: "bg-blue-100 text-blue-700",
    border: "border-blue-200",
    glow: "shadow-blue-200",
    category: "streak",
    streakDays: 30,
  },
  {
    id: "century_club",
    emoji: "🚀",
    name: "Century Club",
    description: "Reach an incredible 100-day streak.",
    color: "bg-rose-100 text-rose-700",
    border: "border-rose-200",
    glow: "shadow-rose-200",
    category: "streak",
    streakDays: 100,
  },
  {
    id: "collector",
    emoji: "🗂️",
    name: "Collector",
    description: "Have 5 or more active habits at once.",
    color: "bg-indigo-100 text-indigo-700",
    border: "border-indigo-200",
    glow: "shadow-indigo-200",
    category: "count",
    habitCount: 5,
  },
  {
    id: "perfect_week",
    emoji: "✨",
    name: "Perfect Week",
    description: "Complete all habits every day for any 7-day window.",
    color: "bg-purple-100 text-purple-700",
    border: "border-purple-200",
    glow: "shadow-purple-200",
    category: "perfect",
  },
  {
    id: "perfect_month",
    emoji: "💎",
    name: "Perfect Month",
    description: "100% completion rate across all habits for a full calendar month.",
    color: "bg-cyan-100 text-cyan-700",
    border: "border-cyan-200",
    glow: "shadow-cyan-200",
    category: "perfect",
  },
  {
    id: "comeback_kid",
    emoji: "💪",
    name: "Comeback Kid",
    description: "Resume a broken streak: complete a habit after missing exactly 1 day, or use a streak freeze.",
    color: "bg-amber-100 text-amber-700",
    border: "border-amber-200",
    glow: "shadow-amber-200",
    category: "special",
  },
  {
    id: "consistency_king",
    emoji: "👑",
    name: "Consistency King",
    description: "Maintain 80%+ overall completion rate across all habits for 30 days.",
    color: "bg-yellow-100 text-yellow-800",
    border: "border-yellow-300",
    glow: "shadow-yellow-200",
    category: "consistency",
    threshold: 80,
  },
  {
    id: "social_butterfly",
    emoji: "🦋",
    name: "Social Butterfly",
    description: "Join or create a group to track habits with friends.",
    color: "bg-pink-100 text-pink-700",
    border: "border-pink-200",
    glow: "shadow-pink-200",
    category: "social",
  },
];

// Streak-based badge IDs — earn date can be retroactively calculated
export const STREAK_BADGE_IDS = new Set([
  "on_a_roll", "week_warrior", "fortnight_force", "monthly_master", "century_club"
]);

/**
 * Finds the earliest date in a habit's completions where a continuous streak of
 * `requiredDays` was first completed. Returns a YYYY-MM-DD string or null.
 */
export function findStreakEarnedDate(completions, requiredDays) {
  if (!completions?.length) return null;
  const sorted = [...new Set(completions)].sort();
  // Walk forward: build runs of consecutive days
  let runStart = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = parseISO(sorted[i - 1]);
      const curr = parseISO(sorted[i]);
      const gap = (curr - prev) / 86400000;
      if (gap !== 1) runStart = i; // streak broken, reset run start
    }
    const runLength = i - runStart + 1;
    if (runLength >= requiredDays) {
      // The streak was first achieved on this date
      return sorted[i];
    }
  }
  return null;
}

/**
 * Returns the best retroactive earned date across all habits for a streak badge.
 */
export function getStreakBadgeEarnedDate(habits, requiredDays) {
  let earliest = null;
  habits.forEach((h) => {
    const d = findStreakEarnedDate(h.completions || [], requiredDays);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  return earliest;
}

/**
 * Returns { earned: boolean, progress: { current, total, label } } for each badge
 */
export function evaluateBadges(habits, groups, userEmail, freezeEverUsed = false) {
  const myBestStreak = habits.reduce((max, h) => {
    const b = getAllTimeBest(h.completions || []);
    const s = calculateStreak(h.completions || []);
    return Math.max(max, b, s);
  }, 0);

  const habitCount = habits.length;

  // Overall 30-day completion rate
  const last30Days = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
  let totalSlots = 0, totalDone = 0;
  habits.forEach((h) => {
    const c = h.completions || [];
    last30Days.forEach((d) => { totalSlots++; if (c.includes(d)) totalDone++; });
  });
  const consistencyRate = totalSlots > 0 ? Math.round((totalDone / totalSlots) * 100) : 0;

  // Perfect week: any 7-day window where all habits completed every day
  let hasPerfectWeek = false;
  if (habits.length > 0) {
    for (let offset = 0; offset <= 60; offset++) {
      const window = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), offset + i), "yyyy-MM-dd"));
      const perfect = habits.every((h) => window.every((d) => (h.completions || []).includes(d)));
      if (perfect) { hasPerfectWeek = true; break; }
    }
  }

  // Perfect month: any calendar month where all habits 100%
  let hasPerfectMonth = false;
  if (habits.length > 0) {
    for (let m = 0; m < 6; m++) {
      const ref = subDays(new Date(), m * 30);
      const days = eachDayOfInterval({ start: startOfMonth(ref), end: endOfMonth(ref) })
        .map((d) => format(d, "yyyy-MM-dd"));
      const perfect = habits.every((h) => days.every((d) => (h.completions || []).includes(d)));
      if (perfect) { hasPerfectMonth = true; break; }
    }
  }

  // Comeback kid: freeze ever used OR any habit where a streak was broken (gap > 1) then resumed the very next day
  let hasComeback = freezeEverUsed;
  if (!hasComeback) {
    habits.forEach((h) => {
      if (hasComeback) return;
      const sorted = [...new Set(h.completions || [])].sort();
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + "T00:00:00");
        const curr = new Date(sorted[i] + "T00:00:00");
        const gap = (curr - prev) / 86400000;
        // gap > 1 means streak was broken; gap === 2 means they came back exactly the next day after the miss
        if (gap === 2) { hasComeback = true; break; }
      }
    });
  }

  // Social butterfly
  const inGroup = groups.some((g) =>
    g.created_by === userEmail || (g.member_emails || []).includes(userEmail)
  );

  // Current perfect week progress
  const last7 = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
  const perfectWeekSlots = habits.length * 7;
  const perfectWeekDone = habits.length > 0
    ? habits.reduce((s, h) => s + last7.filter((d) => (h.completions || []).includes(d)).length, 0)
    : 0;

  return BADGES.map((badge) => {
    let earned = false;
    let progress = null;

    switch (badge.id) {
      case "first_step":
        earned = habitCount >= 1;
        progress = { current: Math.min(habitCount, 1), total: 1, label: `${Math.min(habitCount, 1)} / 1 habit` };
        break;
      case "on_a_roll":
        earned = myBestStreak >= 3;
        progress = { current: Math.min(myBestStreak, 3), total: 3, label: `${Math.min(myBestStreak, 3)} / 3 days` };
        break;
      case "week_warrior":
        earned = myBestStreak >= 7;
        progress = { current: Math.min(myBestStreak, 7), total: 7, label: `${Math.min(myBestStreak, 7)} / 7 days` };
        break;
      case "fortnight_force":
        earned = myBestStreak >= 14;
        progress = { current: Math.min(myBestStreak, 14), total: 14, label: `${Math.min(myBestStreak, 14)} / 14 days` };
        break;
      case "monthly_master":
        earned = myBestStreak >= 30;
        progress = { current: Math.min(myBestStreak, 30), total: 30, label: `${Math.min(myBestStreak, 30)} / 30 days` };
        break;
      case "century_club":
        earned = myBestStreak >= 100;
        progress = { current: Math.min(myBestStreak, 100), total: 100, label: `${Math.min(myBestStreak, 100)} / 100 days` };
        break;
      case "collector":
        earned = habitCount >= 5;
        progress = { current: Math.min(habitCount, 5), total: 5, label: `${Math.min(habitCount, 5)} / 5 habits` };
        break;
      case "perfect_week":
        earned = hasPerfectWeek;
        progress = { current: perfectWeekDone, total: perfectWeekSlots || 7, label: `${perfectWeekDone} / ${perfectWeekSlots || 7} completions` };
        break;
      case "perfect_month":
        earned = hasPerfectMonth;
        progress = { current: perfectWeekDone, total: perfectWeekSlots || 30, label: "Complete all habits every day for a month" };
        break;
      case "comeback_kid":
        earned = hasComeback || freezeEverUsed;
        progress = { current: earned ? 1 : 0, total: 1, label: earned ? "Achieved!" : "Miss a day, then come back (or use a streak freeze)" };
        break;
      case "consistency_king":
        earned = consistencyRate >= 80 && habits.length > 0;
        progress = { current: Math.min(consistencyRate, 80), total: 80, label: `${consistencyRate}% / 80% consistency` };
        break;
      case "social_butterfly":
        earned = inGroup;
        progress = { current: inGroup ? 1 : 0, total: 1, label: inGroup ? "Group joined!" : "Join or create a group" };
        break;
      default:
        break;
    }

    return { ...badge, earned, progress };
  });
}