/**
 * Notification service for habit reminders.
 * Schedules reminders using setInterval checks every minute.
 */
import { showNotification } from "@/lib/showNotification";

// Tracks the last reminder "slot" (date + HH:mm) fired per habit id, so a
// habit's reminder notification fires at most once per matching minute.
// Needed because startReminderScheduler() below calls check() immediately
// on every invocation, not just on its own 60s interval tick -- and it gets
// re-invoked far more often than that in practice, since the effect that
// calls it (Dashboard.jsx) depends on a `habits` array that wasn't
// memoized there, recreating a new reference (and re-running the effect)
// on every Dashboard render. Without this guard, every render that
// happened to land inside a habit's reminder minute fired a duplicate
// notification for it.
const REMINDER_SENT_KEY = "habit_reminder_sent_slots";

function hasFiredReminderSlot(habitId, slotKey) {
  try {
    const sent = JSON.parse(localStorage.getItem(REMINDER_SENT_KEY) || "{}");
    return sent[habitId] === slotKey;
  } catch {
    return false;
  }
}

function markReminderSlotFired(habitId, slotKey) {
  try {
    const sent = JSON.parse(localStorage.getItem(REMINDER_SENT_KEY) || "{}");
    sent[habitId] = slotKey;
    localStorage.setItem(REMINDER_SENT_KEY, JSON.stringify(sent));
  } catch {
    // Best-effort only (e.g. blocked in some private browsing modes) --
    // worst case here is a possible duplicate, same as before this guard
    // existed, not a crash.
  }
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function canNotify() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export function fireHabitNotification(habit, streak) {
  if (!canNotify()) return;
  const streakText = streak > 0 ? ` 🔥 ${streak} day streak` : "";
  showNotification(habit.name, {
    body: `${habit.name}${streakText}. Time to check in!`,
    icon: "/favicon.ico",
    tag: `habit-${habit.id}`,
    data: { url: window.location.origin + "/Dashboard" },
  });
}

// Main scheduler — call once on app load with the current habits list
let _intervalId = null;

export function startReminderScheduler(getHabits, getStreak) {
  if (_intervalId) clearInterval(_intervalId);

  const check = () => {
    if (!canNotify()) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const todayDow = now.getDay(); // 0=Sun
    const todayDate = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const slotKey = `${todayDate}-${hhmm}`;

    const habits = getHabits();
    habits.forEach((habit) => {
      if (!habit.reminder_time) return;
      if (habit.reminder_time !== hhmm) return;
      const days = habit.reminder_days ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(todayDow)) return;
      if (hasFiredReminderSlot(habit.id, slotKey)) return;
      markReminderSlotFired(habit.id, slotKey);
      const streak = getStreak(habit);
      fireHabitNotification(habit, streak);
    });
  };

  // Check immediately and then every minute
  check();
  _intervalId = setInterval(check, 60 * 1000);
}

export function stopReminderScheduler() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}