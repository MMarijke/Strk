/**
 * Streak Freeze Service — server-backed via StreakFreeze entity.
 * Free plan: 2 freezes per month. Pro plan: unlimited.
 */
import { StreakFreeze } from "@/api/entities";

export const FREE_FREEZES_PER_MONTH = 2;

/** Returns a month key like "2026-07" */
export function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Returns the 1st of next month as a display string */
export function getNextRefreshDateStr() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Load (or create) this month's freeze record for the user.
 * Returns the record object.
 */
export async function loadMonthRecord(userEmail) {
  const monthKey = getCurrentMonthKey();
  const records = await StreakFreeze.filter({ user_email: userEmail, month_key: monthKey });
  if (records.length > 0) return records[0];
  // Create fresh record for this month
  return StreakFreeze.create({
    user_email: userEmail,
    month_key: monthKey,
    used_count: 0,
    frozen_habits: {},
  });
}

/**
 * Returns freezes remaining this month.
 * isPro = true → unlimited (returns 999).
 */
export async function getFreezesRemaining(userEmail, isPro = false) {
  if (isPro) return 999;
  const record = await loadMonthRecord(userEmail);
  return Math.max(0, FREE_FREEZES_PER_MONTH - (record.used_count || 0));
}

/**
 * Returns the frozen date for a specific habit this month, or null.
 */
export async function getFrozenDateForHabit(userEmail, habitId) {
  const record = await loadMonthRecord(userEmail);
  return (record.frozen_habits || {})[habitId] || null;
}

/**
 * Returns the set of habit IDs already frozen this month, for filtering
 * candidates in the dashboard-level freeze prompt without a per-habit fetch.
 */
export async function getFrozenHabitIdsThisMonth(userEmail) {
  const record = await loadMonthRecord(userEmail);
  return new Set(Object.keys(record.frozen_habits || {}));
}

/**
 * Apply a freeze to a habit for the missed date.
 * Returns { success, reason }
 */
export async function applyFreeze(userEmail, habitId, missedDate, isPro = false) {
  const record = await loadMonthRecord(userEmail);
  const usedCount = record.used_count || 0;
  const frozenHabits = record.frozen_habits || {};

  if (!isPro && usedCount >= FREE_FREEZES_PER_MONTH) {
    return { success: false, reason: "No freezes remaining this month. Upgrade to Pro for unlimited freezes." };
  }
  if (frozenHabits[habitId]) {
    return { success: false, reason: "Already used a freeze for this habit this month." };
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
 * Legacy sync check — returns true if the user has any freeze record this
 * month with a used freeze. Used by Badges page. Async version preferred
 * elsewhere.
 */
export async function hasFreezeEverBeenUsed(userEmail) {
  if (!userEmail) return false;
  const monthKey = getCurrentMonthKey();
  const records = await StreakFreeze.filter({ user_email: userEmail, month_key: monthKey });
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
