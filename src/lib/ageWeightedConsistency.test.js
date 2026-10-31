import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { format, subDays } from "date-fns";
import { calculateStats, habitWindowDays, getRank } from "./utils";
import { evaluateBadges } from "./badgeDefinitions";

/**
 * The consistency denominator was a fixed 30, including for a habit that
 * had existed for one day. Because consistency is a mean across habits,
 * adding a new habit to a perfect one cost 48 points and a full tier — as
 * the immediate consequence of the single action this product most wants.
 *
 * These tests pin the arithmetic, the parity between the three client
 * implementations, and the two cases that make a naive fix wrong: dividing
 * by zero on a habit created today, and completions that predate the habit.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const day = (n) => format(subDays(new Date(), n), "yyyy-MM-dd");
const iso = (n) => subDays(new Date(), n).toISOString();

/** A habit created `age` days ago, completed on each of `done` recent days. */
const habit = (age, done, extra = {}) => ({
  archived: false,
  created_date: iso(age),
  completions: done.map(day),
  ...extra,
});

describe("habitWindowDays", () => {
  it("counts the creation day, so a habit made today has a window of 1", () => {
    // Not 0: a 0 would divide by zero.
    expect(habitWindowDays(habit(0, []))).toBe(1);
  });

  it("grows with age and caps at 30", () => {
    expect(habitWindowDays(habit(1, []))).toBe(2);
    expect(habitWindowDays(habit(6, []))).toBe(7);
    expect(habitWindowDays(habit(29, []))).toBe(30);
    expect(habitWindowDays(habit(400, []))).toBe(30);
  });

  it("falls back to 30 when the creation date is missing or unusable", () => {
    // An unknown age must not inflate a rate; 30 is the old behaviour.
    expect(habitWindowDays({ completions: [] })).toBe(30);
    expect(habitWindowDays({ created_date: "not-a-date", completions: [] })).toBe(30);
    expect(habitWindowDays(null)).toBe(30);
  });

  it("clamps a future creation date to 1 rather than going negative", () => {
    const future = { created_date: subDays(new Date(), -5).toISOString(), completions: [] };
    expect(habitWindowDays(future)).toBe(1);
  });

  it("accepts created_at as well as created_date", () => {
    // The entities layer aliases created_at -> created_date on read, but
    // both are present on a row and callers use either.
    expect(habitWindowDays({ created_at: iso(6), completions: [] })).toBe(7);
  });
});

describe("the add-a-habit penalty is gone", () => {
  it("a new habit kept on day one no longer costs a tier", () => {
    const fiftyDayPerfect = habit(50, [...Array(50).keys()]);
    const before = calculateStats([fiftyDayPerfect]);

    const brandNewKeptToday = habit(0, [0]);
    const after = calculateStats([fiftyDayPerfect, brandNewKeptToday]);

    // 1/1 = 100% for the new habit, so the mean stays 100.
    expect(before.consistency).toBe(100);
    expect(after.consistency).toBe(100);
    expect(after.score).toBe(before.score);
    expect(getRank(after.score).title).toBe(getRank(before.score).title);
  });

  it("still penalises a new habit the user is actually neglecting", () => {
    // The fix must not make every new habit free. Created 10 days ago, so
    // the window is 11 — the creation day counts — and two completions
    // give 2/11 = 18.18%. Mean of 100 and 18.18 is 59.09, which rounds
    // to 59.
    const fiftyDayPerfect = habit(50, [...Array(50).keys()]);
    const neglected = habit(10, [0, 5]);
    expect(calculateStats([fiftyDayPerfect, neglected]).consistency).toBe(59);
  });

  it("caps a backfilled habit at 100 rather than reporting 500", () => {
    // Edit Completions lets a user backfill days before the habit existed
    // (SmartReminders.jsx documents the same). Five completions against a
    // 1-day window would be 500% if the numerator were not confined to the
    // window.
    const backfilled = habit(0, [0, 1, 2, 3, 4]);
    const s = calculateStats([backfilled]);
    expect(s.consistency).toBe(100);
    expect(s.consistency).toBeLessThanOrEqual(100);
  });

  it("never divides by zero for a habit created today with nothing done", () => {
    const s = calculateStats([habit(0, [])]);
    expect(Number.isFinite(s.consistency)).toBe(true);
    expect(s.consistency).toBe(0);
  });
});

describe("client matches the server formula", () => {
  /** round(avg(pct)) over each habit's own window — the SQL, ported. */
  function serverConsistency(habits) {
    const active = habits.filter((h) => !h.archived);
    if (!active.length) return 0;
    const pcts = active.map((h) => {
      const w = habitWindowDays(h);
      const days = Array.from({ length: w }, (_, i) => day(i));
      return (days.filter((d) => (h.completions || []).includes(d)).length / w) * 100;
    });
    return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  }

  it("agrees across a spread of ages and completion counts", () => {
    const mismatches = [];
    for (const age of [0, 1, 3, 7, 14, 29, 30, 90]) {
      for (const done of [0, 1, 2, 5, 10, 25]) {
        const hs = [habit(age, [...Array(done).keys()])];
        const client = calculateStats(hs).consistency;
        const server = serverConsistency(hs);
        if (client !== server) mismatches.push(`age ${age}, ${done} done: ${client} vs ${server}`);
      }
    }
    expect(mismatches, "calculateStats disagrees with the SQL formula").toEqual([]);
  });

  it("agrees on mixed-age habit sets, where pooling would not", () => {
    // This is the case that made the old pooled client calculation wrong
    // once windows started differing: sum(k)/sum(w) is not mean(k/w).
    const hs = [habit(30, [...Array(30).keys()]), habit(2, [0])];
    // per-habit mean: (100 + 33.33) / 2 = 66.67 -> 67
    // pooled would be: 31 / 33 = 93.9 -> 94
    expect(calculateStats(hs).consistency).toBe(67);
    expect(calculateStats(hs).consistency).toBe(serverConsistency(hs));
  });

  it("evaluateBadges reports the same consistency as calculateStats", () => {
    // consistency_king is judged on the client for display and recomputed
    // by award_badge for the grant. They must not disagree.
    const hs = [habit(30, [...Array(30).keys()]), habit(2, [0])];
    const badge = evaluateBadges(hs, [], "me@example.com", false)
      .find((b) => b.id === "consistency_king");
    const pct = Number(/^(\d+)%/.exec(badge.progress.label)?.[1]);
    expect(pct).toBe(calculateStats(hs).consistency);
  });
});

describe("the SQL carries the same window", () => {
  function newest(fn) {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let found = null;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
      const re = new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\n\\$\\$;`);
      const m = re.exec(sql);
      if (m) found = m[0];
    }
    return found;
  }

  it("no live function still divides by a hardcoded 30", () => {
    for (const fn of ["sync_profile_stats_from_habits", "award_badge"]) {
      const body = newest(fn);
      expect(body, `${fn} not found`).not.toBeNull();
      const code = body.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(
        code.includes("generate_series(0, 29)"),
        `${fn} still uses a fixed 0..29 consistency window, so it disagrees ` +
        `with calculateStats about every habit younger than 30 days.`
      ).toBe(false);
      expect(code).toContain("window_days");
    }
  });

  it("computes the window the same way in both", () => {
    const sync = newest("sync_profile_stats_from_habits");
    const badge = newest("award_badge");
    // Only the reference date differs: the trigger uses current_date, the
    // RPC uses the caller's own p_today. That asymmetry is pre-existing.
    expect(sync).toContain("greatest(1, least(30, (current_date - h.created_at::date) + 1))");
    expect(badge).toContain("greatest(1, least(30, (p_today - created_at::date) + 1))");
  });

  it("keeps the archived rule and the date-cast guards", () => {
    // Both were added by earlier migrations and are easy to lose when a
    // function is redefined.
    const sync = newest("sync_profile_stats_from_habits");
    expect(sync).toContain("where not archived");
    expect(sync).toContain("d ~ '^\\d{4}-\\d{2}-\\d{2}$'");
    expect(newest("award_badge")).toContain("coalesce(archived, false) = false");
  });
});
