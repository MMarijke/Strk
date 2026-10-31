import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RANKS, RANK_ORDER } from "./utils";

/**
 * The tier ramp.
 *
 * It used to be five raw Tailwind palette picks in a lookup table inside
 * one component: green-500, orange-500, yellow-500, red-500, yellow-400.
 * Non-monotonic in hue, in temperature and in perceived advancement;
 * tiers 3 and 5 landed on two near-identical yellows; tier 2 was
 * essentially the brand primary and read hotter than tier 3; tier 1 was
 * green in a flame-branded product whose first tier is called Ember; and
 * tier 4 used the app's own danger hue for an achievement.
 *
 * These tests pin the three properties that make the replacement a ramp
 * rather than a legend, plus the Tailwind hazard that would ship it
 * silently unstyled.
 */

const ROOT = process.cwd();
const CSS = fs.readFileSync(path.join(ROOT, "src", "index.css"), "utf8");
const MARK = fs.readFileSync(path.join(ROOT, "src", "components", "rank", "RankMark.jsx"), "utf8");

/**
 * MARK with comments stripped.
 *
 * Needed because RankMark's own JSDoc quotes the interpolated form
 * (`--rank-${n}`) as the anti-pattern it is warning against, so an
 * assertion that the file contains no such interpolation matches the
 * warning itself. The documentation of a hazard is not the hazard.
 */
const MARK_CODE = MARK
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

/** Parsed `--rank-N: H S% L%` triples from one CSS block. */
function ramp(blockName) {
  const start = CSS.indexOf(blockName);
  expect(start, `${blockName} not found in index.css`).toBeGreaterThan(-1);
  const block = CSS.slice(start, CSS.indexOf("\n  }", start));
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const m = new RegExp(`--rank-${i}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(block);
    expect(m, `--rank-${i} missing from ${blockName}`).not.toBeNull();
    out.push({ h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) });
  }
  return out;
}

const BLOCKS = [":root", ".dark"];

describe("the ramp is declared as theme tokens", () => {
  it("exists in both light and dark", () => {
    for (const b of BLOCKS) expect(ramp(b)).toHaveLength(5);
  });

  it("has one token per tier, and no more", () => {
    expect(RANKS).toHaveLength(5);
    expect(RANK_ORDER).toHaveLength(5);
    // A sixth tier added without a token would fall back to the first.
    expect(CSS.includes("--rank-6")).toBe(false);
  });
});

describe("the ramp is monotone", () => {
  for (const block of BLOCKS) {
    it(`rises on all three channels in ${block}`, () => {
      // Each channel strictly increasing is what makes "further along"
      // legible without reading the label. Lightness alone being ordered
      // also means the ramp survives greyscale.
      const r = ramp(block);
      for (let i = 1; i < r.length; i++) {
        expect(r[i].h, `hue at rank-${i + 1}`).toBeGreaterThan(r[i - 1].h);
        expect(r[i].s, `saturation at rank-${i + 1}`).toBeGreaterThanOrEqual(r[i - 1].s);
        expect(r[i].l, `lightness at rank-${i + 1}`).toBeGreaterThan(r[i - 1].l);
      }
    });

    it(`keeps adjacent tiers visually apart in ${block}`, () => {
      // The specific old defect: Blaze (#eab308) and the top tier
      // (#facc15) were near-identical. A minimum hue step prevents two
      // tiers reading as one.
      const r = ramp(block);
      for (let i = 1; i < r.length; i++) {
        expect(r[i].h - r[i - 1].h, `hue gap before rank-${i + 1}`).toBeGreaterThanOrEqual(6);
      }
    });
  }
});

describe("no achievement reuses the danger hue", () => {
  it("every rank token stays clear of --destructive", () => {
    // --destructive is hue 0. Tier 4 used to be red-500 outright: the
    // app's "something went wrong" colour, for reaching a tier.
    const destructive = /--destructive:\s*([\d.]+)/.exec(CSS);
    expect(destructive, "--destructive not found").not.toBeNull();
    const dh = Number(destructive[1]);

    for (const block of BLOCKS) {
      for (const [i, c] of ramp(block).entries()) {
        const distance = Math.min(Math.abs(c.h - dh), 360 - Math.abs(c.h - dh));
        expect(distance, `rank-${i + 1} in ${block} is too close to --destructive`).toBeGreaterThan(15);
      }
    }
  });
});

describe("tier appearance lives in one place", () => {
  it("RANKS carries no emoji or colour field", () => {
    // `color` was read by exactly one card, and the emoji contradicted
    // the names they sat beside.
    for (const r of RANKS) {
      expect(r.emoji, `${r.key} still carries an emoji`).toBeUndefined();
      expect(r.color, `${r.key} still carries a colour`).toBeUndefined();
    }
  });

  it("no screen keeps a private rank style lookup", () => {
    for (const rel of [
      "src/components/habits/DashboardSummary.jsx",
      "src/pages/Badges.jsx",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} declares its own RANK_STYLES`).not.toMatch(/const RANK_STYLES\s*=/);
      expect(src, `${rel} does not use the shared style`).toContain("rankStyle(");
    }
  });

  it("covers every tier key, so none falls back silently", () => {
    for (const key of RANK_ORDER) {
      expect(MARK, `RankMark has no entry for ${key}`).toContain(`  ${key}: {`);
    }
  });
});

describe("the Tailwind classes are literal", () => {
  it("never builds a rank class by interpolation", () => {
    // Tailwind's JIT scans source text. `bg-[hsl(var(--rank-${n}))]`
    // compiles, ships, and renders unstyled -- a break that looks like a
    // CSS mistake rather than a missing class.
    expect(MARK_CODE).not.toMatch(/--rank-\$\{/);
    expect(MARK_CODE).not.toMatch(/`[^`]*--rank-[^`]*\$\{/);
  });

  it("spells out all four utilities for every tier", () => {
    for (let i = 1; i <= 5; i++) {
      for (const util of ["text-", "border-", "from-", "bg-"]) {
        expect(
          MARK.includes(`${util}[hsl(var(--rank-${i})`),
          `rank-${i} has no literal ${util} class`
        ).toBe(true);
      }
    }
  });
});
