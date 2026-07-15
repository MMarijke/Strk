/**
 * Streak Freeze Service — server-backed via StreakFreeze entity.
 * Free plan: 1 freeze per week. Pro plan: unlimited.
 */
import { StreakFreeze } from "@/api/entities";

export const FREE_FREEZES_PER_WEEK = 1;

/** Returns ISO week key like "2026-W24" */
export function getCurrentWeekKey() {
  const now = new Date();
  // ISO week number
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const weekNum = Math.floor((now - startOfWeek1) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Returns the Monday of next week as a display string */
export function getNextRefreshDateStr() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilMonday);
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Load (or create) this week's freeze record for the user.
 * Returns the record object.
 */
export async function loadWeekRecord(userEmail) {
  const weekKey = getCurrentWeekKey();
  const records = await StreakFreeze.filter({ user_email: userEmail, week_key: weekKey });
  if (records.length > 0) return records[0];
  // Create fresh record for this week
  return StreakFreeze.create({
    user_email: userEmail,
    week_key: weekKey,
    used_count: 0,
    frozen_habits: {},
  });
}

/**
 * Returns freezes remaining this week.
 * isPro = true → unlimited (returns 999).
 */
export async function getFreezesRemaining(userEmail, isPro = false) {
  if (isPro) return 999;
  const record = await loadWeekRecord(userEmail);
  return Math.max(0, FREE_FREEZES_PER_WEEK - (record.used_count || 0));
}

/**
 * Returns the frozen date for a specific habit this week, or null.
 */
export async function getFrozenDateForHabit(userEmail, habitId) {
  const record = await loadWeekRecord(userEmail);
  return (record.frozen_habits || {})[habitId] || null;
}

/**
 * Apply a freeze to a habit for the missed date.
 * Returns { success, reason }
 */
export async function applyFreeze(userEmail, habitId, missedDate, isPro = false) {
  const record = await loadWeekRecord(userEmail);
  const usedCount = record.used_count || 0;
  const frozenHabits = record.frozen_habits || {};

  if (!isPro && usedCount >= FREE_FREEZES_PER_WEEK) {
    return { success: false, reason: "No freezes remaining this week. Upgrade to Pro for unlimited freezes." };
  }
  if (frozenHabits[habitId]) {
    return { success: false, reason: "Already used a freeze for this habit this week." };
  }

  const updated = await StreakFreeze.update(record.id, {
    used_count: usedCount + 1,
    frozen_habits: { ...frozenHabits, [habitId]: missedDate },
  });

  return { success: true, record: updated };
}

/**
 * Determines if a habit is eligible for a freeze.
 * Returns the missed date string or null.
 */
/**
 * Legacy sync check — returns true if the user has any freeze record this week.
 * Used by Badges page. Async version preferred elsewhere.
 */
export async function hasFreezeEverBeenUsed(userEmail) {
  if (!userEmail) return false;
  const weekKey = getCurrentWeekKey();
  const records = await StreakFreeze.filter({ user_email: userEmail, week_key: weekKey });
  return records.some((r) => (r.used_count || 0) > 0);
}

export function getFreezeEligibleDate(habit) {
  const completions = habit.completions || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  // Already completed yesterday or today — streak not broken
  if (completions.includes(yesterdayStr) || completions.includes(todayStr)) return null;
  if (completions.length === 0) return null;

  // Habit must have been created before yesterday
  if (habit.created_date) {
    const createdDate = new Date(habit.created_date);
    createdDate.setHours(0, 0, 0, 0);
    if (createdDate >= yesterday) return null;
  }

  // Most recent completion must be the day before yesterday
  const sorted = [...completions].sort().reverse();
  const mostRecent = sorted[0];
  const dayBeforeYesterday = new Date(yesterday);
  dayBeforeYesterday.setDate(yesterday.getDate() - 1);
  const dayBeforeYesterdayStr = dayBeforeYesterday.toISOString().slice(0, 10);

  return mostRecent === dayBeforeYesterdayStr ? yesterdayStr : null;
}