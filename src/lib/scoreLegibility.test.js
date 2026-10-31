import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RANKS, WITNESS_SLOTS } from "./utils";

/**
 * The legibility fixes, pinned at source level.
 *
 * Two of these guard factual claims rather than styling. "You are in the
 * top 100% of Strk users" shipped to every new user — the app's only
 * bragging surface opening by telling somebody they were last, in the
 * grammar of a compliment — and "of Strk users" described a population it
 * did not measure, in a product whose positioning is GDPR/POPIA.
 *
 * Source parsing rather than rendering, because these screens need a
 * Supabase client and a QueryClient to mount and the suite has neither.
 */

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with `//` comment lines removed, so a comment cannot satisfy an assertion. */
const code = (rel) =>
  read(rel).split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the percentile claim", () => {
  const src = () => code("src/pages/Badges.jsx");

  it("is withheld until somebody is actually below the user", () => {
    // At myScore 0, usersBelow is 0 and the old arithmetic produced 100.
    expect(src()).toContain("myScore > 0");
    expect(src()).toContain("usersBelow > 0");
  });

  it("can never print 100%", () => {
    expect(src()).toMatch(/Math\.min\(\s*Math\.round\([^)]*\)[^,]*,\s*99\s*\)/);
  });

  it("names the population it measures", () => {
    // allProfiles comes from UserProfile.list, which RLS limits to rows
    // with is_public = true. That is people who share progress, not users.
    expect(src()).toContain("who share progress");
    expect(src()).not.toMatch(/top \{topPct\}% of Strk users</);
  });

  it("bounds the query it used to run unbounded", () => {
    expect(src()).toMatch(/UserProfile\.list\("-best_streak",\s*PERCENTILE_SAMPLE\)/);
    expect(src()).toMatch(/const PERCENTILE_SAMPLE = \d+/);
  });

  it("the entities layer actually honours a limit", () => {
    // A limit argument the data layer ignores would be worse than none:
    // the call would read as bounded and not be.
    const entities = code("src/api/entities.js");
    expect(entities).toMatch(/async list\(sort, limit\)/);
    expect(entities).toMatch(/if \(typeof limit === 'number'\) query = query\.limit\(limit\)/);
  });
});

describe("the score is explainable from both screens", () => {
  it("Dashboard and Badges both open the same breakdown", () => {
    for (const rel of ["src/pages/Dashboard.jsx", "src/pages/Badges.jsx"]) {
      expect(code(rel), `${rel} does not mount the sheet`).toContain("ScoreBreakdownSheet");
      expect(code(rel), `${rel} has no way to open it`).toContain("setShowScoreBreakdown(true)");
    }
  });

  it("opens from a real button, not a tappable div", () => {
    // The only explanation of the score in the product has to be reachable
    // by keyboard and has to announce what it opens.
    for (const rel of ["src/components/habits/DashboardSummary.jsx", "src/pages/Badges.jsx"]) {
      const src = code(rel);
      const m = /<button[\s\S]{0,400}?onClick=\{\(\) => setShowScoreBreakdown\(true\)\}|<button[\s\S]{0,400}?onClick=\{onExplainScore\}/.exec(src);
      expect(m, `${rel} has no button wired to the breakdown`).not.toBeNull();
      expect(src).toContain("See what your score is made of");
    }
  });

  it("feeds the sheet by spreading one calculateStats result", () => {
    // The guarantee is that the breakdown adds up to the number on the
    // card, which holds as long as the sheet's numeric props come from a
    // SPREAD of a calculateStats result rather than being assembled field
    // by field.
    //
    // Asserted as intent, not as a literal `{...calculateStats(`: Dashboard
    // now routes that result through a memo so the sheet and the rank-up
    // modal share one computation, which serves this guarantee better than
    // calling it twice. An earlier version of this test pinned the spelling
    // and failed on the improvement.
    for (const rel of ["src/pages/Dashboard.jsx", "src/pages/Badges.jsx"]) {
      const src = code(rel);
      const block = /<ScoreBreakdownSheet[\s\S]*?\/>/.exec(src);
      expect(block, `${rel} does not render the sheet`).not.toBeNull();
      expect(
        /\{\.\.\.\w+\}|\{\.\.\.calculateStats\(/.test(block[0]),
        `${rel} hand-assembles the sheet's props instead of spreading one result`
      ).toBe(true);
      expect(src, `${rel} never calls calculateStats`).toContain("calculateStats(");
    }
  });
});

describe("the breakdown sheet", () => {
  const src = () => code("src/components/rank/ScoreBreakdownSheet.jsx");

  it("shows the user's own working, not the abstract formula", () => {
    // "Best Streak x 2 + Consistency %" was already printed on Social and
    // taught nobody anything. A definition is not an answer.
    const s = src();
    expect(s).toContain("Current form");
    expect(s).toContain("Consistency");
    expect(s).toContain("Witnessed");
    expect(s).not.toContain("Best Streak × 2 + Consistency %");
  });

  it("renders every witness slot, lit or not", () => {
    // The unlit rows are the point: each names a social feature the user
    // has not used yet.
    expect(src()).toMatch(/WITNESS_SLOTS\.map/);
    expect(WITNESS_SLOTS.length).toBe(5);
    for (const slot of WITNESS_SLOTS) {
      expect(slot.label, "a slot has no label").toBeTruthy();
      expect(slot.hint, `${slot.key} has no hint, so an unlit row teaches nothing`).toBeTruthy();
    }
  });

  it("renders the whole ladder and marks the user's place", () => {
    const s = src();
    expect(s).toMatch(/RANKS\.map/);
    expect(s).toContain("aria-current");
    expect(s).toContain("you are here");
  });

  it("finally reads maxScore", () => {
    // maxScore was declared on all five tiers and read by nothing, which
    // is exactly why the ladder could not be rendered. The critique's
    // instruction was to use it or delete it.
    expect(src()).toContain("r.maxScore");
    expect(RANKS.every((r) => r.maxScore !== undefined)).toBe(true);
  });
});

describe("no surface still crowns a tier that has no crown", () => {
  it("drops the leftover Legend crown copy", () => {
    // "Maximum rank 👑" and "to 👑 Legend" outlived the tier itself.
    for (const rel of [
      "src/components/habits/DashboardSummary.jsx",
      "src/pages/Badges.jsx",
    ]) {
      const src = code(rel);
      expect(src, `${rel} still says Maximum rank`).not.toContain("Maximum rank");
      expect(src).toContain("Top of the ladder");
    }
  });
});

describe("the progress bars announce themselves", () => {
  it("carry progressbar semantics and a real accessible value", () => {
    // Previously width and tier colour only — invisible to a screen reader
    // and to anyone who cannot separate the two near-identical yellows.
    for (const rel of [
      "src/components/habits/DashboardSummary.jsx",
      "src/pages/Badges.jsx",
    ]) {
      const src = code(rel);
      expect(src, `${rel} bar has no role`).toContain('role="progressbar"');
      expect(src).toContain("aria-valuenow");
      expect(src).toContain("aria-valuetext");
    }
  });
});
