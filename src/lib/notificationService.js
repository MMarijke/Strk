/**
 * Notification service for habit reminders.
 * Schedules reminders using setInterval checks every minute.
 */
import { showNotification } from "@/lib/showNotification";

const STORAGE_KEY = "habit_reminder_timers";

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

    const habits = getHabits();
    habits.forEach((habit) => {
      if (!habit.reminder_time) return;
      if (habit.reminder_time !== hhmm) return;
      const days = habit.reminder_days ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(todayDow)) return;
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