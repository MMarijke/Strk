/**
 * Streak Freeze Service — server-backed via StreakFreeze entity.
 * Free plan: 2 freezes per month. Pro plan: unlimited.
 */
import { StreakFreeze } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { format } from "date-fns";

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
 * Single source of this month's freeze state: how many freezes remain,
 * and the full { habitId: frozenDateString } map. One loadMonthRecord()
 * call for both, computed once at the dashboard level and threaded down
 * as props from there -- replaces getFreezesRemaining()/
 * getFrozenDateForHabit()/getFrozenHabitIdsThisMonth(), which each
 * independently re-fetched the same single row (previously called from
 * Dashboard.jsx twice, FreezeIndicator.jsx once, and every individual
 * HabitCard twice more -- 2 + 2N requests for N habits, all hitting the
 * identical row).
 * isPro = true → freezesRemaining is unlimited (999).
 */
export async function getFreezeMonthState(userEmail, isPro = false) {
  const record = await loadMonthRecord(userEmail);
  const frozenHabits = record.frozen_habits || {};
  const freezesRemaining = isPro ? 999 : Math.max(0, FREE_FREEZES_PER_MONTH - (record.used_count || 0));
  return { freezesRemaining, frozenHabits };
}

/**
 * Apply a freeze to a habit for the missed date.
 * Returns { success, reason }
 *
 * Routed through the apply_streak_freeze() RPC rather than a direct
 * StreakFreeze.update() — the limit check has to happen server-side,
 * looking up the caller's real plan itself, not from a client-supplied
 * isPro flag. A BEFORE UPDATE trigger on streak_freezes now rejects any
 * direct write to used_count/frozen_habits that doesn't come through
 * this RPC, so a client-side-only check was no longer just insufficient,
 * it would fail outright.
 */
export async function applyFreeze(habitId, missedDate) {
  const { data, error } = await supabase.rpc("apply_streak_freeze", {
    p_habit_id: habitId,
    p_missed_date: missedDate,
  });

  if (error) {
    return { success: false, reason: error.message || "Failed to apply freeze." };
  }
  if (!data.success) {
    return { success: false, reason: data.reason };
  }
  return { success: true, record: data.record };
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

/**
 * A habit must have existed since before `yesterday` (a zeroed-time Date)
 * to be freeze-eligible. Backfilling via Edit Completions can produce a
 * completion dated before a habit's own created_date -- perfectly legitimate
 * for a user reconstructing recent history right after adding a habit --
 * so this can't be inferred from completions alone; it has to check
 * created_date explicitly. Exported so any other "is this actually
 * freeze-eligible" surface (e.g. SmartReminders' "you missed X yesterday"
 * message) can apply the identical rule instead of re-deriving it.
 */
export function isOldEnoughForFreeze(habit, yesterday) {
  if (!habit.created_date) return true;
  const createdDate = new Date(habit.created_date);
  createdDate.setHours(0, 0, 0, 0);
  return createdDate < yesterday;
}

export function getFreezeEligibleDate(habit) {
  const completions = habit.completions || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  // format() (local time) not toISOString() (UTC) -- for any timezone
  // ahead of UTC, local midnight already falls on the previous UTC
  // calendar day, so a UTC-based string here silently ran a day behind
  // the real local date, delaying freeze eligibility by an extra day.
  const yesterdayStr = format(yesterday, "yyyy-MM-dd");
  const todayStr = format(today, "yyyy-MM-dd");

  // Already completed yesterday or today — streak not broken
  if (completions.includes(yesterdayStr) || completions.includes(todayStr)) return null;
  if (completions.length === 0) return null;

  if (!isOldEnoughForFreeze(habit, yesterday)) return null;

  // Most recent completion must be the day before yesterday
  const sorted = [...completions].sort().reverse();
  const mostRecent = sorted[0];
  const dayBeforeYesterday = new Date(yesterday);
  dayBeforeYesterday.setDate(yesterday.getDate() - 1);
  const dayBeforeYesterdayStr = format(dayBeforeYesterday, "yyyy-MM-dd");

  return mostRecent === dayBeforeYesterdayStr ? yesterdayStr : null;
}
