// Weekly digest email — meant to be invoked on a schedule (Monday mornings),
// not by end users. Protected by a shared secret rather than a user JWT,
// since there's no signed-in user in a cron invocation context.
//
// Set up the schedule via Supabase Dashboard -> Edge Functions -> Cron Jobs
// (or a pg_cron + pg_net job calling this URL) — see README for details.
//
// Also the only place group-weekly-report data gets computed: it persists
// last_week_completion_rate / prev_week_completion_rate /
// last_week_top_habit_name / last_week_top_habit_count onto user_profiles
// for every user with habits, regardless of email_weekly_digest — that
// flag only gates whether the email itself gets sent, decoupled from
// whether their groupmates see real weekly numbers. See the 20260811090004
// migration and groupDigestService.js's buildMemberWeeklyRankings /
// getGroupTopHabitLastWeek, which read these columns for every member
// except the viewer (the viewer's own row is always computed live,
// client-side, from their own fresher habits query).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { emailShell } from "../_shared/email-template.ts";
import { initSentry, captureException } from "../_shared/sentry.ts";
import { requireEnv } from "../_shared/env.ts";

initSentry("send-weekly-digest");

const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "Strk <hello@strk.app>";
const CRON_SECRET = requireEnv("CRON_SECRET");
const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

// Constant-time comparison, same as paddle-webhook's signature check --
// `!==` on a secret header is a (largely theoretical, but free to close)
// timing side channel that a fixed-time compare doesn't have.
function isValidCronSecret(provided: string | null): boolean {
  if (!provided) return false;
  const expected = Buffer.from(CRON_SECRET);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Real Mon-Sun calendar-week boundaries, matching the client's
// calcWeeklyRate/getWeekCompletions (date-fns startOfWeek/endOfWeek with
// weekStartsOn: 1) exactly -- not the old "7 days ending yesterday"
// rolling window, which only produced the same result as a real calendar
// week if this cron fired precisely Monday morning. Two clients (this
// function computing other members' rows, the browser computing the
// viewer's own row live) drifting to different week boundaries would mean
// "Last Week" disagreeing between the two for the exact same calendar
// week -- pinning both to the same explicit boundary logic removes that.
// weeksAgo=1 is the most recently completed week, weeksAgo=2 the one
// before that.
function weekBounds(weeksAgo: number): { start: string; end: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
  const sinceMonday = (dayOfWeek + 6) % 7;
  const thisWeekMonday = new Date(now);
  thisWeekMonday.setDate(now.getDate() - sinceMonday);

  const start = new Date(thisWeekMonday);
  start.setDate(thisWeekMonday.getDate() - weeksAgo * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return { start: isoDate(start), end: isoDate(end) };
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    dates.push(isoDate(d));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function completionRate(habits: { completions: string[] }[], dates: string[]): number {
  if (!habits.length || !dates.length) return 0;
  const total = habits.length * dates.length;
  const completed = habits.reduce(
    (sum, h) => sum + dates.filter((d) => (h.completions || []).includes(d)).length,
    0
  );
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

// All-time total completions, for the email body only -- unrelated to and
// deliberately not reused for the week-scoped columns below.
function topStreakHabit(habits: { name: string; completions: string[] }[]) {
  if (!habits.length) return null;
  return habits.reduce((best, h) => {
    const streak = (h.completions || []).length;
    const bestStreak = best ? (best.completions || []).length : -1;
    return streak > bestStreak ? h : best;
  }, null as null | { name: string; completions: string[] });
}

// Top habit within a specific set of dates, for last_week_top_habit_*.
// Returns null if the max is 0 (nobody completed anything that week) --
// deliberately stricter than the client's getTopHabitLastWeek (which
// happily returns a 0-count "winner"), since this feeds a cross-member
// "Highest Group Completion" comparison where a fabricated 0-count winner
// would be misleading rather than just unused, the way it is client-side
// for a single always-visible viewer.
function topHabitInRange(
  habits: { name: string; completions: string[] }[],
  dates: string[]
): { name: string; count: number } | null {
  if (!habits.length) return null;
  let best: { name: string; count: number } | null = null;
  for (const h of habits) {
    const count = dates.filter((d) => (h.completions || []).includes(d)).length;
    if (!best || count > best.count) best = { name: h.name, count };
  }
  return best && best.count > 0 ? best : null;
}

function motivationalMessage(rate: number): string {
  if (rate >= 80) return "You're on fire! Another incredible week in the books 🔥";
  if (rate >= 50) return "Good effort this week! Even small steps count, keep going 👏";
  return "Life happens. What matters is you're back. This week is yours 💙";
}

type Profile = {
  created_by_id: string;
  created_by: string | null;
  display_name: string | null;
  email_weekly_digest: boolean;
};

// Runs `fn` over `items` with at most `limit` in flight at once, rather
// than fully sequentially (the previous shape) or fully unbounded
// (Promise.all over everyone). Sequential processing of every user, one
// DB round-trip plus a conditional Resend call each, is what pushed this
// function past pg_net's http_post timeout for the last two Monday runs
// (see the matching migration) -- unbounded concurrency would fix that
// but risks tripping Resend's own rate limit as the user base grows.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function processProfile(
  profile: Profile,
  lastWeekDates: string[],
  prevWeekDates: string[]
): Promise<{ sent: boolean; statsUpdated: boolean }> {
  if (!profile.created_by) return { sent: false, statsUpdated: false };

  const { data: habits, error: habitsError } = await supabase
    .from("habits")
    .select("name, completions")
    .eq("created_by_id", profile.created_by_id)
    .eq("archived", false);

  if (habitsError) {
    // created_by_id (uuid), not created_by (email) -- this function
    // iterates and processes every user's row, so it's the one place in
    // the codebase most exposed to accidentally logging raw addresses at
    // volume; captureException still gets the real error, Sentry-scoped.
    console.error("send-weekly-digest: failed to load habits for", profile.created_by_id, habitsError);
    await captureException(habitsError, { where: "load habits", profileId: profile.created_by_id });
    return { sent: false, statsUpdated: false };
  }
  if (!habits?.length) return { sent: false, statsUpdated: false }; // nothing to report yet

  const lastWeekRate = completionRate(habits, lastWeekDates);
  const prevWeekRate = completionRate(habits, prevWeekDates);
  const lastWeekTop = topHabitInRange(habits, lastWeekDates);

  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({
      last_week_completion_rate: lastWeekRate,
      prev_week_completion_rate: prevWeekRate,
      last_week_top_habit_name: lastWeekTop?.name ?? null,
      last_week_top_habit_count: lastWeekTop?.count ?? null,
    })
    .eq("created_by_id", profile.created_by_id);

  let statsUpdated = false;
  if (updateError) {
    console.error("send-weekly-digest: failed to update weekly stats for", profile.created_by_id, updateError);
    await captureException(updateError, { where: "update weekly stats", profileId: profile.created_by_id });
  } else {
    statsUpdated = true;
  }

  if (!profile.email_weekly_digest) return { sent: false, statsUpdated };

  const top = topStreakHabit(habits);
  const name = profile.display_name || profile.created_by.split("@")[0];

  const html = emailShell({
    preheader: `Your week in review: ${lastWeekRate}% completion rate`,
    heading: `Your week in review, ${name} 📊`,
    body: `
      <p>${motivationalMessage(lastWeekRate)}</p>
      <p><strong>${lastWeekRate}%</strong> average completion rate across your habits last week.</p>
      ${
        top
          ? `<p>Top habit: <strong>${top.name}</strong> with ${(top.completions || []).length} total completions.</p>`
          : ""
      }
    `,
    ctaLabel: "Open Strk",
    ctaUrl: "https://strk-seven.vercel.app/Trends",
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: profile.created_by, subject: "Your week in review 📊", html }),
  });

  if (res.ok) {
    return { sent: true, statsUpdated };
  }

  const resendBody = await res.text();
  console.error("send-weekly-digest: Resend error for", profile.created_by_id, res.status, resendBody);
  await captureException(new Error(`Resend error ${res.status}: ${resendBody}`), {
    where: "resend send",
    profileId: profile.created_by_id,
  });
  return { sent: false, statsUpdated };
}

Deno.serve(async (req) => {
  if (!isValidCronSecret(req.headers.get("x-cron-secret"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const lastWeek = weekBounds(1);
  const prevWeek = weekBounds(2);
  const lastWeekDates = datesInRange(lastWeek.start, lastWeek.end);
  const prevWeekDates = datesInRange(prevWeek.start, prevWeek.end);

  // No longer filtered to email_weekly_digest=true here -- stats get
  // computed for everyone with habits so their groupmates see real
  // numbers regardless of that opt-in; the flag only gates the email send
  // further down.
  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("created_by_id, created_by, display_name, email_weekly_digest");

  if (profilesError) {
    console.error("send-weekly-digest: failed to load profiles", profilesError);
    await captureException(profilesError, { where: "load profiles" });
    return new Response(JSON.stringify({ error: "Failed to load profiles" }), { status: 500 });
  }

  const results = await mapWithConcurrency(profiles ?? [], 5, (profile) =>
    processProfile(profile, lastWeekDates, prevWeekDates)
  );

  const sent = results.filter((r) => r.sent).length;
  const statsUpdated = results.filter((r) => r.statsUpdated).length;

  return new Response(JSON.stringify({ sent, statsUpdated, total: profiles?.length ?? 0 }), { status: 200 });
});
