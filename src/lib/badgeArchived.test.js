import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { format, subDays } from "date-fns";
import { evaluateBadges } from "./badgeDefinitions";

/**
 * The archived-habit rule, on both sides of the wire.
 *
 * 20261025090002 set the rule: a historical achievement counts every
 * habit, a forward-looking rate counts only habits still tracked. It
 * taught sync_profile_stats_from_habits and calculateStats, and never
 * touched award_badge or badgeDefinitions.js -- so for three badges a
 * retired habit still counted, and for two of them (perfect_week,
 * perfect_month) a single archived habit made the badge permanently
 * unreachable, silently.
 *
 * These tests cover the client directly, and assert the SQL carries the
 * matching filter. Both halves matter: the client decides what the Badges
 * screen SHOWS, award_badge decides what is actually GRANTED, and the
 * failure they used to share was invisible precisely because they agreed.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

/** The exact filter the stats trigger uses, as it appears in the SQL. */
const GUARD = "d ~ '^\\d{4}-\\d{2}-\\d{2}$'";

const day = (n) => format(subDays(new Date(), n), "yyyy-MM-dd");
/** A habit completed every day for the last `n` days. */
const perfect = (n, extra = {}) => ({
  completions: Array.from({ length: n }, (_, i) => day(i)),
  ...extra,
});

function badge(habits, id, groups = []) {
  return evaluateBadges(habits, groups, "me@example.com", false).find((b) => b.id === id);
}

describe("archived habits and badge eligibility (client)", () => {
  it("a retired habit no longer drags consistency_king down", () => {
    // One habit kept perfectly for 30 days, one abandoned and archived.
    const habits = [perfect(30), { archived: true, completions: ["2025-01-01"] }];
    expect(badge(habits, "consistency_king").earned).toBe(true);
  });

  it("still refuses consistency_king on a genuinely poor rate", () => {
    // Active habit done 10 of 30 days = 33%, below the 80 threshold.
    expect(badge([perfect(10)], "consistency_king").earned).toBe(false);
  });

  it("a retired habit no longer blocks perfect_week", () => {
    const habits = [perfect(10), { archived: true, completions: ["2025-01-01"] }];
    // The archived habit has no completions in any recent window, so
    // including it made `every habit every day` impossible for good.
    expect(badge(habits, "perfect_week").earned).toBe(true);
  });

  it("does not award perfect_week to an account tracking nothing", () => {
    // The regression the filter invites: `[].every(...)` is true, so
    // without a length guard an all-archived account scores a perfect week.
    const habits = [{ archived: true, completions: [] }];
    expect(badge(habits, "perfect_week").earned).toBe(false);
    expect(badge(habits, "perfect_month").earned).toBe(false);
    expect(badge(habits, "consistency_king").earned).toBe(false);
  });

  it("keeps counting every habit for the historical badges", () => {
    // collector is "5 habits", not "5 habits you still track" -- archiving
    // one should not take it away, and award_badge counts the same way.
    const habits = Array.from({ length: 5 }, (_, i) => ({
      completions: [],
      archived: i < 2,
    }));
    expect(badge(habits, "collector").earned).toBe(true);
    expect(badge(habits, "first_step").earned).toBe(true);
  });

  it("keeps counting archived habits toward a best streak", () => {
    // The all-time best is a record somebody set; retiring the habit must
    // not erase it.
    const habits = [{ archived: true, completions: Array.from({ length: 7 }, (_, i) => day(40 + i)) }];
    expect(badge(habits, "week_warrior").earned).toBe(true);
  });
});

describe("archived habits and badge eligibility (award_badge SQL)", () => {
  /** The newest migration that redefines award_badge. */
  function awardBadgeSource() {
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let found = null;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create or replace function public\.award_badge/.test(sql)) found = sql;
    }
    expect(found, "no migration defines award_badge").not.toBeNull();
    return found;
  }

  /** The body of one `elsif p_badge_id = '<id>' then` branch. */
  function branch(sql, id) {
    const start = sql.indexOf(`p_badge_id = '${id}' then`);
    expect(start, `branch for ${id} not found`).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const end = rest.search(/\n  elsif p_badge_id|\n  end if;/);
    return rest.slice(0, end === -1 ? undefined : end);
  }

  it("filters archived in the three forward-looking badges", () => {
    const sql = awardBadgeSource();
    for (const id of ["consistency_king", "perfect_week", "perfect_month"]) {
      expect(
        /coalesce\((h\.)?archived, false\) = false/.test(branch(sql, id)),
        `award_badge's ${id} branch does not filter archived habits, so it ` +
        `disagrees with badgeDefinitions.js and with the rule 20261025090002 set.`
      ).toBe(true);
    }
  });

  it("guards the forward-looking badges on the ACTIVE habit count", () => {
    const sql = awardBadgeSource();
    for (const id of ["consistency_king", "perfect_week", "perfect_month"]) {
      expect(
        /v_active_habit_count = 0/.test(branch(sql, id)),
        `award_badge's ${id} branch guards on v_habit_count, which counts ` +
        `archived habits. With the archived filter applied, an account ` +
        `tracking nothing passes the guard and perfect_week's NOT EXISTS ` +
        `is vacuously true.`
      ).toBe(true);
    }
  });

  it("guards every date cast against a malformed completion entry", () => {
    // 20260915090001 exists because `d::date` throws for the whole array if
    // any single element is not a date literal, on every call thereafter.
    // award_badge has no `exception when others` backstop, so one legacy
    // bad date means no streak badge, ever, as a hard RPC failure.
    const sql = awardBadgeSource();
    // Strip comments first: an earlier version of this test counted the
    // guard quoted in the migration's own header and passed while a real
    // cast site had none.
    const code = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    const sites = [...code.matchAll(/unnest\((?:oh|hb)\.completions\) as d/g)];
    expect(sites.length, "no unnest of completions found -- regex drifted").toBeGreaterThan(0);

    const unguarded = sites
      .filter((m) => {
        // The guard belongs in the same SELECT, which in this file is
        // always within a line or two of the unnest.
        const window = code.slice(m.index, m.index + 200);
        // Literal substring, not a regex: in a JS regex `\d` means "a
        // digit", so a pattern written to look like the SQL would never
        // match the backslash the SQL actually contains.
        return !window.includes(GUARD);
      })
      .map((m) => code.slice(Math.max(0, m.index - 80), m.index + 40).trim().replace(/\s+/g, " "));

    expect(
      unguarded,
      "These unnest(...) sites cast completions to date with no " +
      "'^\\d{4}-\\d{2}-\\d{2}$' guard. One malformed legacy entry makes the " +
      "whole array uncastable and the RPC throws on every later call."
    ).toEqual([]);
  });
});
