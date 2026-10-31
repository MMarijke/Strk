import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { format, subDays, startOfWeek } from "date-fns";
import { calculateStats } from "./utils";

/**
 * ScoreHistoryChart used to print the leaderboard's exact caption --
 * "Score = Best Streak x 2 + Consistency %" -- over a number computed a
 * different way, and the gap was large: for one habit kept perfectly for
 * 30 days plus one long-archived habit, the leaderboard said 100%
 * consistency and the chart said 43%.
 *
 * It now samples calculateStats at four week-ends instead of keeping its
 * own arithmetic. These tests pin the two properties that made the old
 * version wrong, and assert the chart has not grown a private copy again.
 */

const ROOT = process.cwd();
const CHART = path.join(ROOT, "src", "components", "social", "ScoreHistoryChart.jsx");

const day = (n) => format(subDays(new Date(), n), "yyyy-MM-dd");

/** Mirrors the component's own sampling, so the assertions test the real shape. */
function weeklySamples(habits) {
  const today = new Date();
  return Array.from({ length: 4 }, (_, i) => {
    const weekStart = startOfWeek(subDays(today, (3 - i) * 7), { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    const asOf = weekEnd > today ? today : weekEnd;
    return calculateStats(habits, asOf);
  });
}

describe("calculateStats with an as-of date", () => {
  it("defaults to now, so existing callers are unaffected", () => {
    const habits = [{ archived: false, completions: [day(0), day(1), day(2)] }];
    expect(calculateStats(habits)).toEqual(calculateStats(habits, new Date()));
  });

  it("ignores completions after the as-of date", () => {
    // A 10-day run ending today, sampled as of 5 days ago, is a 5-day run.
    const habits = [{ archived: false, completions: Array.from({ length: 10 }, (_, i) => day(i)) }];
    expect(calculateStats(habits, subDays(new Date(), 5)).bestStreak).toBe(5);
    expect(calculateStats(habits).bestStreak).toBe(10);
  });
});

describe("the chart's latest point is the leaderboard score", () => {
  it("agrees exactly, which is what the shared caption claims", () => {
    const habits = [
      { archived: false, completions: Array.from({ length: 30 }, (_, i) => day(i)) },
      { archived: true, completions: ["2025-01-01", "2025-01-02"] },
    ];
    const samples = weeklySamples(habits);
    const latest = samples[samples.length - 1];
    const leaderboard = calculateStats(habits);

    expect(latest.score).toBe(leaderboard.score);
    expect(latest.consistency).toBe(leaderboard.consistency);
    expect(latest.bestStreak).toBe(leaderboard.bestStreak);
  });

  it("is not depressed by days of the current week that have not happened", () => {
    // The old denominator was habits x 7 regardless of the weekday, so on
    // a Monday the best attainable consistency was 1/7 = 14%.
    const habits = [{ archived: false, completions: Array.from({ length: 30 }, (_, i) => day(i)) }];
    const latest = weeklySamples(habits).at(-1);
    expect(latest.consistency).toBe(100);
  });

  it("is not halved by a retired habit", () => {
    const perfect = { archived: false, completions: Array.from({ length: 30 }, (_, i) => day(i)) };
    const withArchived = weeklySamples([perfect, { archived: true, completions: ["2025-01-01"] }]).at(-1);
    const without = weeklySamples([perfect]).at(-1);
    expect(withArchived.consistency).toBe(without.consistency);
  });
});

describe("ScoreHistoryChart does not keep its own score arithmetic", () => {
  const source = () => fs.readFileSync(CHART, "utf8");

  it("calls calculateStats rather than re-deriving the formula", () => {
    const src = source();
    expect(src).toContain("calculateStats");
    // The weighting belongs to scoreFromParts/calculateStats. A literal
    // "* 2 +" here is how the two definitions drifted apart before.
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(
      code.includes("* 2 +"),
      "ScoreHistoryChart has re-inlined the score weighting. It is the one " +
      "file that already drifted from the leaderboard this way."
    ).toBe(false);
  });

  it("no longer computes a 7-day consistency of its own", () => {
    expect(source()).not.toContain("calcWeekConsistency");
    expect(source()).not.toContain("calcWeekBestStreak");
  });
});
