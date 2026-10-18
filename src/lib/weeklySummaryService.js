import { format, subDays, startOfWeek, endOfWeek, isMonday } from "date-fns";
import { showNotification } from "@/lib/showNotification";

const STORAGE_KEY = "weeklySummary";

function getKey(userEmail) {
  return `${STORAGE_KEY}_${userEmail}`;
}

function getWeekRange(offset = 0) {
  // offset=0 = this week, offset=1 = last week, etc.
  const ref = subDays(new Date(), offset * 7);
  const start = startOfWeek(ref, { weekStartsOn: 1 }); // Monday start
  const end = endOfWeek(ref, { weekStartsOn: 1 });
  return { start, end };
}

function getDatesInRange(start, end) {
  const dates = [];
  let cur = new Date(start);
  while (cur <= end) {
    dates.push(format(cur, "yyyy-MM-dd"));
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function calcWeekCompletionRate(habits, weekOffset = 1) {
  const { start, end } = getWeekRange(weekOffset);
  const dates = getDatesInRange(start, end);
  if (!habits.length || !dates.length) return 0;
  const total = habits.length * dates.length;
  const completed = habits.reduce((sum, h) => {
    return sum + dates.filter((d) => (h.completions || []).includes(d)).length;
  }, 0);
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

export function getTopStreakHabit(habits) {
  if (!habits.length) return null;
  return habits.reduce((best, h) => {
    const streak = (h.completions || []).length;
    const bestStreak = best ? (best.completions || []).length : -1;
    return streak > bestStreak ? h : best;
  }, null);
}

const MOTIVATIONAL_MESSAGES = {
  high: [
    "You're on fire! Another incredible week in the books 🔥",
    "Absolutely crushing it, consistency is your superpower! 💪",
    "Look at you go! The habits are building a better you, one day at a time 🌟",
    "Outstanding week! Keep this momentum going 🚀",
    "You're making it look easy, incredible discipline! ⭐",
  ],
  mid: [
    "Good effort this week! Even small steps count, keep going 👏",
    "You showed up, and that's what matters. This week will be even better! 💫",
    "Solid week! You're building the foundation, keep stacking those days 📈",
    "Progress over perfection, you're moving in the right direction! 🌱",
    "Every check-in counts! You've got the momentum to build on 🎯",
  ],
  low: [
    "Life happens. What matters is you're back. This week is yours 💙",
    "Don't be hard on yourself. Every new week is a fresh start 🌅",
    "The best time to reset is today. You've got this! 🤍",
    "Small steps are still steps forward. Be kind to yourself and keep going 🌸",
    "We all have tough weeks. Tomorrow is a brand new chance 🌈",
  ],
};

export function getMotivationalMessage(rate, lastMessage) {
  const pool = rate >= 80 ? MOTIVATIONAL_MESSAGES.high
    : rate >= 50 ? MOTIVATIONAL_MESSAGES.mid
    : MOTIVATIONAL_MESSAGES.low;
  const filtered = pool.filter((m) => m !== lastMessage);
  const list = filtered.length > 0 ? filtered : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// Was gated to isMonday(new Date()) -- meaning anyone who didn't happen to
// open the app on Monday itself never saw that week's recap at all, not
// just later. thisMonday already identifies "this week" regardless of
// which day it currently is (startOfWeek always resolves to the current
// week's Monday), so the dismissedWeek check alone is sufficient: the card
// now surfaces on the first open of the week, whichever day that is, and
// keeps showing until dismissed or the week rolls over.
export function isSummaryVisible(userEmail) {
  const key = getKey(userEmail);
  const raw = localStorage.getItem(key);
  const thisMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  if (!raw) return true;
  const state = JSON.parse(raw);
  return state.dismissedWeek !== thisMonday;
}

export function dismissSummary(userEmail, lastMessage) {
  const thisMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const key = getKey(userEmail);
  localStorage.setItem(key, JSON.stringify({ dismissedWeek: thisMonday, lastMessage }));
}

export function getLastMessage(userEmail) {
  const key = getKey(userEmail);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw).lastMessage || null;
}

// Weekly summary notification
const NOTIF_KEY = "weeklySummaryNotif";

export function getWeeklySummaryNotifEnabled() {
  const raw = localStorage.getItem(NOTIF_KEY);
  if (raw === null) return true; // default on
  return JSON.parse(raw);
}

export function setWeeklySummaryNotifEnabled(val) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(val));
}

const SENT_KEY = "weeklySummaryNotifSent";

export function scheduleWeeklySummaryNotif() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!getWeeklySummaryNotifEnabled()) return;
  if (!isMonday(new Date())) return;

  const today = format(new Date(), "yyyy-MM-dd");
  const sent = localStorage.getItem(SENT_KEY);
  if (sent === today) return;

  const now = new Date();
  const targetHour = 9;
  if (now.getHours() < targetHour) {
    const delay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, 0, 0) - now;
    setTimeout(() => {
      if (Notification.permission === "granted") {
        showNotification("Your week in review 📊", {
          body: "Tap to see how you did last week!",
          icon: "/favicon.ico",
          data: { url: `${window.location.origin}/Trends` },
        });
        localStorage.setItem(SENT_KEY, today);
      }
    }, delay);
  } else if (now.getHours() === targetHour && now.getMinutes() < 5) {
    showNotification("Your week in review 📊", {
      body: "Tap to see how you did last week!",
      icon: "/favicon.ico",
      data: { url: `${window.location.origin}/Trends` },
    });
    localStorage.setItem(SENT_KEY, today);
  }
}