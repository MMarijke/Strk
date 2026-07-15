// Weekly digest email — meant to be invoked on a schedule (Monday mornings),
// not by end users. Protected by a shared secret rather than a user JWT,
// since there's no signed-in user in a cron invocation context.
//
// Set up the schedule via Supabase Dashboard -> Edge Functions -> Cron Jobs
// (or a pg_cron + pg_net job calling this URL) — see README for details.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell } from "../_shared/email-template.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "Strk <hello@strk.app>";
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// The 7 days ending yesterday — assumes this runs Monday morning.
function lastWeekDates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(isoDate(d));
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

function topStreakHabit(habits: { name: string; completions: string[] }[]) {
  if (!habits.length) return null;
  return habits.reduce((best, h) => {
    const streak = (h.completions || []).length;
    const bestStreak = best ? (best.completions || []).length : -1;
    return streak > bestStreak ? h : best;
  }, null as null | { name: string; completions: string[] });
}

function motivationalMessage(rate: number): string {
  if (rate >= 80) return "You're on fire! Another incredible week in the books 🔥";
  if (rate >= 50) return "Good effort this week! Even small steps count — keep going 👏";
  return "Life happens — what matters is you're back. This week is yours 💙";
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dates = lastWeekDates();

  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("created_by_id, created_by, display_name")
    .eq("email_weekly_digest", true);

  if (profilesError) {
    console.error("send-weekly-digest: failed to load profiles", profilesError);
    return new Response(JSON.stringify({ error: "Failed to load profiles" }), { status: 500 });
  }

  let sent = 0;
  for (const profile of profiles ?? []) {
    if (!profile.created_by) continue;

    const { data: habits, error: habitsError } = await supabase
      .from("habits")
      .select("name, completions")
      .eq("created_by_id", profile.created_by_id)
      .eq("archived", false);

    if (habitsError) {
      console.error("send-weekly-digest: failed to load habits for", profile.created_by, habitsError);
      continue;
    }
    if (!habits?.length) continue; // nothing to report yet, skip the email

    const rate = completionRate(habits, dates);
    const top = topStreakHabit(habits);
    const name = profile.display_name || profile.created_by.split("@")[0];

    const html = emailShell({
      preheader: `Your week in review: ${rate}% completion rate`,
      heading: `Your week in review, ${name} 📊`,
      body: `
        <p>${motivationalMessage(rate)}</p>
        <p><strong>${rate}%</strong> average completion rate across your habits last week.</p>
        ${
          top
            ? `<p>Top habit: <strong>${top.name}</strong> with ${(top.completions || []).length} total completions.</p>`
            : ""
        }
      `,
      ctaLabel: "Open Strk",
      ctaUrl: "https://strk.app/Trends",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: profile.created_by, subject: "Your week in review 📊", html }),
    });

    if (res.ok) sent++;
    else console.error("send-weekly-digest: Resend error for", profile.created_by, res.status, await res.text());
  }

  return new Response(JSON.stringify({ sent, total: profiles?.length ?? 0 }), { status: 200 });
});
