import { describe, it, expect } from "vitest";
import { format, subDays } from "date-fns";
import { calculateStreak } from "./StreakWidget";

// calculateStreak's whole behavior is relative to "now", so every date here
// is built the same way the function itself builds "today"/"yesterday" --
// relative to the actual run time, not hardcoded strings that would drift
// stale the day after this file is written.
function daysAgo(n) {
  return format(subDays(new Date(), n), "yyyy-MM-dd");
}

describe("calculateStreak", () => {
  it("returns 0 for no completions", () => {
    expect(calculateStreak([])).toBe(0);
    expect(calculateStreak(null)).toBe(0);
  });

  it("counts a single completion today as a 1-day streak", () => {
    expect(calculateStreak([daysAgo(0)])).toBe(1);
  });

  it("counts a consecutive run ending today", () => {
    expect(calculateStreak([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3);
  });

  it("still counts an active streak if the most recent completion was yesterday, not today", () => {
    // Today's habit hasn't been checked off yet -- the streak from
    // yesterday backward is still "alive" per the function's own rule.
    expect(calculateStreak([daysAgo(1), daysAgo(2), daysAgo(3)])).toBe(3);
  });

  it("returns 0 if the most recent completion is 2+ days old -- the streak has actually broken", () => {
    expect(calculateStreak([daysAgo(2), daysAgo(3), daysAgo(4)])).toBe(0);
  });

  it("stops counting at the first gap, even with older completions beyond it", () => {
    // Missing daysAgo(2) breaks the run; the 2 older entries don't count.
    expect(calculateStreak([daysAgo(0), daysAgo(1), daysAgo(3), daysAgo(4)])).toBe(2);
  });

  it("dedupes a date entered twice instead of inflating the count", () => {
    expect(calculateStreak([daysAgo(0), daysAgo(0), daysAgo(1)])).toBe(2);
  });

  describe("with a frozen date filling a gap", () => {
    it("bridges the gap, extending the streak through the frozen day", () => {
      // daysAgo(1) is missing from real completions but frozen -- the
      // streak should treat it as covered and keep counting past it.
      expect(calculateStreak([daysAgo(0), daysAgo(2), daysAgo(3)], daysAgo(1))).toBe(4);
    });

    it("doesn't double-count a frozen date that's already a real completion", () => {
      expect(calculateStreak([daysAgo(0), daysAgo(1)], daysAgo(1))).toBe(2);
    });

    it("a frozen date outside the active run doesn't resurrect an already-broken streak", () => {
      // Most recent real completion is 3 days ago -- freezing an even older
      // day doesn't make the streak "active" again; today/yesterday still
      // has nothing.
      expect(calculateStreak([daysAgo(3), daysAgo(4)], daysAgo(5))).toBe(0);
    });
  });
});
