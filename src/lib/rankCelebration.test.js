import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RANKS } from "./utils";

/**
 * The celebration and the accessibility gaps around it.
 *
 * Three of these guard things that were defects rather than roughness:
 * an unconditional five-second dismiss on a dialog with interactive
 * controls (WCAG 2.2.1 Timing Adjustable), two share paths with no
 * rejection handling, and tier emoji rendered as bare text so a screen
 * reader announced "seedling" and "high voltage" instead of a tier name
 * that appeared nowhere else on either leaderboard.
 *
 * Source-level, because these components need a Dialog portal, a Supabase
 * client and a QueryClient to mount and the suite has none of them.
 */

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/**
 * Source with comments stripped — both `//` lines and block comments.
 *
 * Block comments matter here specifically. These assertions are about code
 * that was REMOVED, and the components explain at length what was removed
 * and why. An earlier version of this helper stripped only `//` lines, so
 * "has no auto-close timer" failed by matching the JSDoc sentence
 * describing the very timer it had just deleted.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const code = (rel) =>
  read(rel)
    .replace(BLOCK_COMMENT, "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const MODAL = "src/components/rank/RankUpModal.jsx";

describe("the rank-up modal does not dismiss itself", () => {
  it("has no auto-close timer at all", () => {
    // Was setTimeout(onClose, 5000), unconditional -- so it fired while
    // the user was still inside the OS share sheet, and they came back to
    // find the celebration gone with no way to see it again. WCAG 2.2.1
    // requires a time limit to be adjustable, extendable or absent; two
    // buttons already provided a manual way out, so the timer is removed
    // rather than lengthened.
    const src = code(MODAL);
    expect(src).not.toMatch(/setTimeout\(\s*onClose/);
    expect(src).not.toMatch(/setTimeout\([^)]*,\s*5000\s*\)/);
  });

  it("still closes on an explicit action", () => {
    // Removing the timer must not leave the dialog inescapable.
    const src = code(MODAL);
    expect(src).toContain("onClick={onClose}");
    expect(src).toMatch(/onOpenChange=\{\(open\) => \{ if \(!open\) onClose\(\); \}\}/);
  });
});

describe("both share paths handle rejection", () => {
  const src = () => code(MODAL);

  it("catches navigator.share and treats a dismissal as not an error", () => {
    // AbortError is the user changing their mind. It has to be caught --
    // it was an unhandled rejection on an ordinary action -- but it must
    // not be reported as a failure.
    expect(src()).toMatch(/await navigator\.share\(/);
    expect(src()).toContain("AbortError");
    expect(src()).toMatch(/catch\s*\(\s*err\s*\)/);
  });

  it("catches the clipboard fallback and says so either way", () => {
    // clipboard.writeText rejects without a user gesture or permission.
    // Silently, before -- so the fallback claimed a copy that never
    // happened.
    const s = src();
    expect(s).toMatch(/await navigator\.clipboard\.writeText\(/);
    expect(s).toMatch(/toast\.success/);
    expect(s).toMatch(/toast\.error/);
  });

  it("drops the duplicated flame and carries a human fact", () => {
    // The old payload was "I just ranked up to 🔥 Flame on Strk! 🔥" --
    // two flame emoji, and "Flame" means nothing to a recipient who does
    // not use Strk. A day count is something a friend can react to.
    const s = src();
    expect(s).not.toContain("ranked up to ${rank.emoji}");
    expect(s).toMatch(/days? running|rollingBest/);
  });
});

describe("the celebration states what was earned", () => {
  const src = () => code(MODAL);

  it("takes the score and the form, not just the tier", () => {
    expect(src()).toMatch(/function RankUpModal\(\{[^}]*score[^}]*\}\)/);
    expect(src()).toMatch(/function RankUpModal\(\{[^}]*rollingBest[^}]*\}\)/);
  });

  it("shows the number and the next threshold", () => {
    const s = src();
    expect(s).toMatch(/\{score\} points/);
    expect(s).toMatch(/nextRank\.minScore - score/);
  });

  it("names the rank and score in the accessible description", () => {
    // The old sr-only text said only "You've reached a new rank in Strk",
    // omitting which rank, the score and the threshold -- so the
    // announcement carried none of the content.
    const s = src();
    expect(s).not.toContain("You've reached a new rank in Strk.");
    expect(s).toMatch(/You are now \$\{rank\.title\} with \$\{score\} points/);
  });

  it("hides the decorative glyph from the accessible name", () => {
    // The hero glyph is RankMark now, not a text-8xl emoji, and RankMark
    // is aria-hidden by default (asserted in its own describe below). The
    // guarantee is that the modal shows the drawn mark and announces the
    // tier through the title, not that a particular class carries an
    // aria-hidden attribute.
    const s = src();
    expect(s).toMatch(/<RankMark rankKey=\{rank\.key\}/);
    expect(s, "still renders a raw rank emoji").not.toMatch(/rank\.emoji/);
  });
});

describe("a missed celebration is recoverable", () => {
  it("a migration adds the rank-reached log", () => {
    const dir = path.join(ROOT, "supabase", "migrations");
    const found = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .some((sql) => /add column if not exists rank_reached_at jsonb/.test(sql));
    expect(found, "nothing records when a tier was reached").toBe(true);
  });

  it("Dashboard stamps the tier without overwriting an earlier date", () => {
    // The FIRST time a tier was reached is the fact worth keeping. A user
    // who drops a tier and re-earns it has not reached it anew.
    const src = code("src/pages/Dashboard.jsx");
    expect(src).toContain("rank_reached_at");
    expect(src).toMatch(/userProfile\.rank_reached_at\?\.\[currentRank\.key\]\s*\n?\s*\?\?/);
  });

  it("the ladder shows the dates, which is the point of storing them", () => {
    const src = code("src/components/rank/ScoreBreakdownSheet.jsx");
    expect(src).toContain("rankReachedAt");
    expect(src).toContain("reachedLabel");
  });

  it("a tier earned before the column existed is not given an invented date", () => {
    // Backfilling a guess would put a specific wrong day in front of the
    // user and look authoritative.
    const src = code("src/components/rank/ScoreBreakdownSheet.jsx");
    expect(src).toMatch(/if \(!stamp\) return "Reached";/);
  });

  it("both screens pass the log in", () => {
    for (const rel of ["src/pages/Dashboard.jsx", "src/pages/Badges.jsx"]) {
      expect(code(rel), `${rel} does not pass rankReachedAt`).toMatch(/rankReachedAt=\{/);
    }
  });
});

describe("the dead modal in Badges is gone", () => {
  it("leaves no import, state or render behind", () => {
    // It was imported and rendered while setRankUpRank was never called
    // with a rank -- a celebration that could not fire. Deleted rather
    // than wired up: Dashboard already celebrates, and two screens
    // celebrating one event is worse than one.
    const src = read("src/pages/Badges.jsx");
    expect(src).not.toContain("RankUpModal");
    expect(src).not.toContain("rankUpRank");
  });
});

describe("the tier glyph is decorative and the name is announced", () => {
  it("both leaderboards draw the mark and announce the tier name", () => {
    // The tier NAME appeared nowhere on either screen, for anybody --
    // sighted users saw an unexplained emoji and screen-reader users heard
    // "volcano".
    //
    // Asserted as the guarantee, not the mechanism: the emoji are gone
    // entirely now, replaced by RankMark, so an earlier version of this
    // test that matched `aria-hidden="true">{getRank(...).emoji}` was
    // pinning an implementation rather than the outcome.
    for (const rel of ["src/pages/Social.jsx", "src/components/groups/GroupDashboard.jsx"]) {
      const src = code(rel);
      expect(src, `${rel} does not draw the tier mark`).toMatch(
        /<RankMark rankKey=\{getRank\([^)]*\)\.key\}/
      );
      expect(src, `${rel} never announces the tier name`).toMatch(
        /sr-only">\{getRank\([^)]*\)\.title\}/
      );
      expect(src, `${rel} still renders a raw rank emoji`).not.toMatch(/getRank\([^)]*\)\.emoji/);
    }
  });

  it("RankMark is decorative unless a caller asks otherwise", () => {
    // Every call site renders the tier name alongside it, so the glyph
    // must not be announced a second time.
    const src = code("src/components/rank/RankMark.jsx");
    expect(src).toMatch(/decorative = true/);
    expect(src).toMatch(/aria-hidden=\{decorative \? "true" : undefined\}/);
  });

  it("every tier has a title to announce", () => {
    expect(RANKS.every((r) => typeof r.title === "string" && r.title.length > 0)).toBe(true);
  });
});
