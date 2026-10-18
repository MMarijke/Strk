import { format, subDays, startOfWeek, endOfWeek, isWithinInterval, parseISO } from "date-fns";
import { showNotification } from "@/lib/showNotification";

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
 * Builds per-member weekly stats. "me" is computed live from the viewer's
 * own (always fresher) habits query; every other member reads
 * last_week_completion_rate / prev_week_completion_rate off their
 * user_profiles row, populated weekly by send-weekly-digest. hasData is
 * false when that row hasn't been computed yet (new signup, or a private
 * profile invisible under RLS) -- distinct from a genuine 0%, so the UI
 * can show "no data yet" instead of a fabricated zero, same distinction
 * the group leaderboard fix made for best_streak/consistency_score.
 * Returns array sorted by thisWeekRate desc, hasData: false rows last.
 */
export function buildMemberWeeklyRankings(memberEmails, userEmail, habits, profiles = []) {
  return memberEmails.map((email) => {
    if (email === userEmail) {
      const thisWeek = calcWeeklyRate(habits, 1);
      const prevWeek = calcWeeklyRate(habits, 2);
      return { email, name: email.split("@")[0], thisWeek, prevWeek, improvement: thisWeek - prevWeek, hasData: true };
    }
    const profile = profiles.find((p) => p.created_by === email);
    if (!profile || profile.last_week_completion_rate == null) {
      return { email, name: email.split("@")[0], thisWeek: null, prevWeek: null, improvement: null, hasData: false };
    }
    const thisWeek = profile.last_week_completion_rate;
    const prevWeek = profile.prev_week_completion_rate;
    return {
      email,
      name: email.split("@")[0],
      thisWeek,
      prevWeek: prevWeek ?? 0,
      improvement: prevWeek != null ? thisWeek - prevWeek : null,
      hasData: true,
    };
  }).sort((a, b) => (b.thisWeek ?? -1) - (a.thisWeek ?? -1));
}

/**
 * The group's real top habit for last week, by completion count -- "me"
 * computed live from real habits data, every other member read off their
 * last_week_top_habit_name/last_week_top_habit_count (populated weekly by
 * send-weekly-digest). Returns null if no member has any completions to
 * report yet. Replaces getTopHabitLastWeek(habits) as used in
 * GroupWeeklyReport.jsx's "Highest Group Completion" card, which
 * previously only ever showed the viewer's own top habit mislabeled as
 * group-wide.
 */
export function getGroupTopHabitLastWeek(memberEmails, userEmail, habits, profiles = []) {
  let best = null;

  const myTop = getTopHabitLastWeek(habits);
  if (myTop) {
    const myCount = getWeekCompletions(myTop.completions || [], 1).length;
    if (myCount > 0) best = { name: myTop.name, count: myCount, email: userEmail };
  }

  memberEmails.forEach((email) => {
    if (email === userEmail) return;
    const profile = profiles.find((p) => p.created_by === email);
    if (!profile || profile.last_week_top_habit_count == null) return;
    if (!best || profile.last_week_top_habit_count > best.count) {
      best = { name: profile.last_week_top_habit_name, count: profile.last_week_top_habit_count, email };
    }
  });

  return best;
}

/**
 * Fires a browser notification for the group digest.
 */
export function fireGroupDigestNotification(group, topMemberName, topStreak, completionRate) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  showNotification(`${group.name} weekly results 📊`, {
    body: `${topMemberName} led with a ${topStreak}-day streak. Group completion: ${completionRate}%. Tap to see the breakdown.`,
    icon: "/favicon.ico",
    tag: `digest-${group.id}`,
    data: { url: `${window.location.origin}/Social` },
  });
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