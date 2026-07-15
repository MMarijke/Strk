import { format, subDays, startOfWeek, endOfWeek, isWithinInterval, parseISO } from "date-fns";

const DIGEST_STORAGE_KEY = "group_digest_last_sent";

/**
 * Returns completions for a specific week (Mon-Sun).
 * weeksAgo=0 = current week, weeksAgo=1 = last week
 */
export function getWeekCompletions(completions = [], weeksAgo = 0) {
  const now = new Date();
  const weekStart = startOfWeek(subDays(now, weeksAgo * 7), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(subDays(now, weeksAgo * 7), { weekStartsOn: 1 });
  return completions.filter((d) => {
    try {
      return isWithinInterval(parseISO(d), { start: weekStart, end: weekEnd });
    } catch { return false; }
  });
}

/**
 * Calculates weekly completion rate for a set of habits (0–100).
 */
export function calcWeeklyRate(habits, weeksAgo = 0) {
  if (!habits.length) return 0;
  const total = habits.reduce((sum, h) => {
    const weekCompletions = getWeekCompletions(h.completions || [], weeksAgo);
    return sum + weekCompletions.length;
  }, 0);
  const maxPossible = habits.length * 7;
  return Math.round((total / maxPossible) * 100);
}

/**
 * Finds the habit with highest completions last week.
 */
export function getTopHabitLastWeek(habits) {
  if (!habits.length) return null;
  return habits.reduce((best, h) => {
    const count = getWeekCompletions(h.completions || [], 1).length;
    const bestCount = best ? getWeekCompletions(best.completions || [], 1).length : -1;
    return count > bestCount ? h : best;
  }, null);
}

/**
 * Builds per-member weekly stats (using current user's data for "me", zeros for others).
 * Returns array sorted by thisWeekRate desc.
 */
export function buildMemberWeeklyRankings(memberEmails, userEmail, habits) {
  return memberEmails.map((email) => {
    if (email === userEmail) {
      const thisWeek = calcWeeklyRate(habits, 1);
      const prevWeek = calcWeeklyRate(habits, 2);
      return { email, name: email.split("@")[0], thisWeek, prevWeek, improvement: thisWeek - prevWeek };
    }
    return { email, name: email.split("@")[0], thisWeek: 0, prevWeek: 0, improvement: 0 };
  }).sort((a, b) => b.thisWeek - a.thisWeek);
}

/**
 * Fires a browser notification for the group digest.
 */
export function fireGroupDigestNotification(group, topMemberName, topStreak, completionRate) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const n = new Notification(`${group.name} weekly results 📊`, {
    body: `${topMemberName} led with a ${topStreak}-day streak. Group completion: ${completionRate}%. Tap to see the breakdown.`,
    icon: "/favicon.ico",
    tag: `digest-${group.id}`,
    data: { url: `${window.location.origin}/Social` },
  });
  n.onclick = () => { window.focus(); n.close(); };
}

/**
 * Schedules Monday 9AM digest. Call once on app load with a getter for habits + groups.
 */
let _digestIntervalId = null;

export function startDigestScheduler(getGroups, getHabits, getUserEmail) {
  if (_digestIntervalId) clearInterval(_digestIntervalId);

  const check = () => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const now = new Date();
    if (now.getDay() !== 1) return; // Monday only
    if (now.getHours() !== 9 || now.getMinutes() !== 0) return;

    const todayKey = format(now, "yyyy-MM-dd");
    const lastSent = localStorage.getItem(DIGEST_STORAGE_KEY);
    if (lastSent === todayKey) return; // already sent today

    const groups = getGroups();
    const habits = getHabits();
    const userEmail = getUserEmail();

    const myGroups = groups.filter(
      (g) => g.created_by === userEmail || (g.member_emails || []).includes(userEmail)
    );

    myGroups.forEach((group) => {
      const rate = calcWeeklyRate(habits, 1);
      const topStreak = habits.reduce((m, h) => {
        const wc = getWeekCompletions(h.completions || [], 1).length;
        return Math.max(m, wc);
      }, 0);
      fireGroupDigestNotification(group, userEmail?.split("@")[0] || "You", topStreak, rate);
    });

    localStorage.setItem(DIGEST_STORAGE_KEY, todayKey);
  };

  check();
  _digestIntervalId = setInterval(check, 60 * 1000);
}

export function stopDigestScheduler() {
  if (_digestIntervalId) { clearInterval(_digestIntervalId); _digestIntervalId = null; }
}