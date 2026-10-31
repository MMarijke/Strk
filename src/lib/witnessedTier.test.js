import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { format, subDays } from "date-fns";
import {
  RANKS,
  RANK_ORDER,
  WITNESS_SLOTS,
  calculateStats,
  calculateScore,
  getRank,
  normalizeRankKey,
  rollingBest,
  scoreFromParts,
  witnessFactor,
} from "./utils";

/**
 * The witnessed tier formula:
 *
 *   score = (rollingBest90 * 2 + consistency) * (1 + witness)
 *
 * Two properties carry the whole design and are asserted here rather than
 * trusted:
 *
 *   1. The score can always move and can fall, so the present outranks the
 *      absent. The old all-time-best form term made every user's score a
 *      flat line past their peak, and made a dormant ex-champion outrank
 *      an active newcomer by 240 points.
 *   2. The solo ceiling (280) sits BELOW the top tier's threshold (300).
 *      That gap is how the top tier becomes social without a lockout rule.
 *      Move one number without the other and the design breaks silently.
 */

const day = (n) => format(subDays(new Date(), n), "yyyy-MM-dd");
const run = (from, len) => Array.from({ length: len }, (_, i) => day(from + i));
const perfect = (len) => ({ archived: false, completions: run(0, len) });

const ALL_LIT = Object.fromEntries(WITNESS_SLOTS.map((s) => [s.key, true]));

describe("the ladder", () => {
  it("is five tiers ending in Wildfire, with Legend gone", () => {
    expect(RANK_ORDER).toEqual(["ember", "flame", "blaze", "inferno", "wildfire"]);
    expect(RANKS.map((r) => r.title)).toEqual(["Ember", "Flame", "Blaze", "Inferno", "Wildfire"]);
  });

  it("has contiguous bands with no gap or overlap", () => {
    // A gap would leave a score with no tier; an overlap would make
    // getRank's answer depend on array order.
    for (let i = 0; i < RANKS.length - 1; i++) {
      expect(RANKS[i].maxScore + 1).toBe(RANKS[i + 1].minScore);
    }
    expect(RANKS[0].minScore).toBe(0);
    expect(RANKS.at(-1).maxScore).toBe(Infinity);
  });

  it("places every boundary score in the tier that claims it", () => {
    for (const r of RANKS) {
      expect(getRank(r.minScore).key, `minScore ${r.minScore}`).toBe(r.key);
      if (Number.isFinite(r.maxScore)) {
        expect(getRank(r.maxScore).key, `maxScore ${r.maxScore}`).toBe(r.key);
      }
    }
  });

  it("clamps a negative score to the first tier", () => {
    expect(getRank(-50).key).toBe("ember");
  });

  it("maps the retired legend key to wildfire", () => {
    // Unmapped, RANK_ORDER.indexOf returns -1, which reads as "no tier
    // ever reached" and re-fires the celebration for a past peak.
    expect(normalizeRankKey("legend")).toBe("wildfire");
    expect(RANK_ORDER.indexOf(normalizeRankKey("legend"))).toBe(4);
    expect(normalizeRankKey("blaze")).toBe("blaze");
    expect(normalizeRankKey(null)).toBe(null);
  });
});

describe("witnessFactor", () => {
  it("is 10% per lit slot, up to 50%", () => {
    expect(witnessFactor({})).toBe(0);
    expect(witnessFactor({ reacted: true })).toBeCloseTo(0.1);
    expect(witnessFactor({ reacted: true, assist: true })).toBeCloseTo(0.2);
    expect(witnessFactor(ALL_LIT)).toBeCloseTo(0.5);
  });

  it("survives the shapes the column actually produces", () => {
    // witness_slots defaults to '{}' for a row the trigger has not reached.
    expect(witnessFactor(null)).toBe(0);
    expect(witnessFactor(undefined)).toBe(0);
    expect(witnessFactor("not an object")).toBe(0);
    expect(witnessFactor([])).toBe(0);
  });

  it("ignores unknown keys and non-true values", () => {
    // So adding a slot server-side before the client knows it cannot
    // inflate anyone's score, and a stray string cannot count as lit.
    expect(witnessFactor({ somethingNew: true })).toBe(0);
    expect(witnessFactor({ reacted: "yes" })).toBe(0);
    expect(witnessFactor({ reacted: 1 })).toBe(0);
  });
});

describe("rollingBest", () => {
  it("finds the longest run inside the window", () => {
    expect(rollingBest(run(0, 10))).toBe(10);
    expect(rollingBest([...run(0, 3), ...run(10, 5)])).toBe(5);
  });

  it("caps at the window length", () => {
    // A 120-day run still going reads as 90, by construction.
    expect(rollingBest(run(0, 120))).toBe(90);
  });

  it("drops a run that has aged out entirely", () => {
    // This is what makes the score fall, and what kills the inversion.
    expect(rollingBest(run(200, 40))).toBe(0);
  });

  it("counts only the in-window part of a run that straddles the edge", () => {
    // 100 consecutive days ending today: only the last 90 are in window.
    expect(rollingBest(run(0, 100))).toBe(90);
  });

  it("ignores unparseable entries rather than throwing", () => {
    expect(() => rollingBest([...run(0, 3), "garbage"])).not.toThrow();
    expect(rollingBest([...run(0, 3), "garbage"])).toBe(3);
  });
});

describe("the two defects this formula exists to fix", () => {
  it("the present now outranks the absent", () => {
    // The headline inversion: under the old formula these were 400 (Legend)
    // and 160 (Blaze), with the dormant user ahead by 240.
    const dormantChampion = calculateStats([
      { archived: false, completions: run(200, 200) },
    ]);
    const activeNewcomer = calculateStats([perfect(30)]);

    expect(dormantChampion.score).toBe(0);
    expect(getRank(dormantChampion.score).key).toBe("ember");
    expect(activeNewcomer.score).toBeGreaterThan(dormantChampion.score);
    expect(getRank(activeNewcomer.score).key).toBe("blaze");

    // The record itself is not erased -- it moves to the Peak field.
    expect(dormantChampion.bestStreak).toBe(200);
  });

  it("the score can still move after a record is broken", () => {
    // Old behaviour: best-ever 60 pinned the score inside [120, 220]
    // forever. Now a fresh 20-day run is simply a 20-day run.
    const brokenRecord = [{
      archived: false,
      completions: [...run(200, 60), ...run(0, 20)],
    }];
    const s = calculateStats(brokenRecord);
    expect(s.bestStreak).toBe(60);
    expect(s.rollingBest).toBe(20);
    expect(s.score).toBe(scoreFromParts(20, s.consistency, 0));
  });
});

describe("the solo ceiling sits below the top tier", () => {
  const SOLO_CEILING = 280; // 90 * 2 + 100
  const WILDFIRE = RANKS.at(-1).minScore;

  it("a flawless solo user tops out one tier short", () => {
    const flawlessSolo = calculateStats([perfect(90)], new Date(), 0);
    expect(flawlessSolo.base).toBe(SOLO_CEILING);
    expect(flawlessSolo.score).toBe(SOLO_CEILING);
    expect(flawlessSolo.score).toBeLessThan(WILDFIRE);
    expect(getRank(flawlessSolo.score).key).toBe("inferno");
  });

  it("the gap is the design, not an accident", () => {
    // If these ever cross, the top tier becomes reachable alone and the
    // whole point of the multiplier is gone -- silently.
    expect(SOLO_CEILING).toBeLessThan(WILDFIRE);
    expect(WILDFIRE - SOLO_CEILING).toBeGreaterThan(0);
  });

  it("witness is what carries a user over", () => {
    const habits = [perfect(90)];
    // Solo: 280, one short of the 300 threshold.
    expect(calculateScore(habits, 0)).toBe(280);
    expect(getRank(calculateScore(habits, 0)).key).toBe("inferno");
    // A single lit slot is enough to cross: 280 * 1.1 = 308.
    expect(calculateScore(habits, 0.1)).toBe(308);
    expect(getRank(calculateScore(habits, 0.1)).key).toBe("wildfire");
    // All five: the absolute ceiling.
    expect(calculateScore(habits, 0.5)).toBe(420);
  });

  it("never exceeds 420", () => {
    expect(calculateScore([perfect(120)], 0.5)).toBe(420);
  });
});

describe("scoreFromParts", () => {
  it("applies the multiplier to the whole base", () => {
    expect(scoreFromParts(10, 50, 0)).toBe(70);
    expect(scoreFromParts(10, 50, 0.2)).toBe(84); // 70 * 1.2
    expect(scoreFromParts(10, 50, 0.5)).toBe(105);
  });

  it("rounds once, at the end", () => {
    // 2*7 + 33 = 47; 47 * 1.3 = 61.1 -> 61
    expect(scoreFromParts(7, 33, 0.3)).toBe(61);
  });

  it("treats missing parts as zero, since the columns can be null", () => {
    expect(scoreFromParts(null, undefined)).toBe(0);
    expect(scoreFromParts(undefined, 40)).toBe(40);
    expect(scoreFromParts(10, 20, null)).toBe(40);
  });
});

describe("no client site still scores a peer off all-time best", () => {
  const ROOT = process.cwd();
  const SITES = [
    "src/pages/Social.jsx",
    "src/pages/Badges.jsx",
    "src/components/groups/GroupDashboard.jsx",
  ];

  it("reads rolling_best_streak_90 and witness_slots, not best_streak", () => {
    // best_streak is now the Peak record. A site still passing it to
    // scoreFromParts would rank other people on a monotone number while
    // ranking the viewer on a decaying one -- the asymmetry that made the
    // old leaderboard wrong in the first place.
    const offenders = [];
    for (const rel of SITES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const calls = [...src.matchAll(/scoreFromParts\(([^;]*?)\)/g)].map((m) => m[1]);
      for (const args of calls) {
        if (/\bbest_streak\b/.test(args)) offenders.push(`${rel}: ${args.trim()}`);
        if (!/witness/i.test(args)) offenders.push(`${rel} (no witness): ${args.trim()}`);
      }
      expect(calls.length, `${rel} has no scoreFromParts call`).toBeGreaterThan(0);
    }
    expect(offenders).toEqual([]);
  });

  it("Dashboard no longer hardcodes its own ladder order", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/pages/Dashboard.jsx"), "utf8");
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/const RANK_ORDER\s*=\s*\[/);
    expect(code).toContain("normalizeRankKey");
  });
});

describe("the stored legend key is migrated", () => {
  it("a migration rewrites highest_rank", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const hit = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .some((sql) => /update public\.user_profiles[\s\S]*?set highest_rank = 'wildfire'[\s\S]*?where highest_rank = 'legend'/.test(sql));
    expect(
      hit,
      "No migration rewrites highest_rank from 'legend'. The client " +
      "normalizes it, but leaving the stored value means that " +
      "normalization is load-bearing forever."
    ).toBe(true);
  });
});
