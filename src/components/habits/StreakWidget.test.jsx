import { describe, it, expect } from "vitest";
import { format, subDays } from "date-fns";
import { calculateStreak, bestActiveStreak } from "./StreakWidget";

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

describe("bestActiveStreak", () => {
  it("returns 0 with no habits", () => {
    expect(bestActiveStreak([])).toBe(0);
    expect(bestActiveStreak(undefined, undefined)).toBe(0);
  });

  it("takes the highest current streak across habits", () => {
    const habits = [
      { id: "a", completions: [daysAgo(0), daysAgo(1)] },
      { id: "b", completions: [daysAgo(0), daysAgo(1), daysAgo(2), daysAgo(3)] },
    ];
    expect(bestActiveStreak(habits)).toBe(4);
  });

  it("counts a frozen day, so it agrees with the habit's own card", () => {
    // The bug this guards: DashboardSummary computed this without each
    // habit's frozen date, while HabitCard has always passed it -- so one
    // habit reported two different streaks on two surfaces of the same
    // screen. 18 real days, a frozen gap, then 4 more behind it: 23.
    const completions = [];
    for (let i = 0; i < 18; i++) completions.push(daysAgo(i));
    for (let i = 19; i < 23; i++) completions.push(daysAgo(i));
    const habits = [{ id: "a", completions }];
    const frozen = { a: daysAgo(18) };

    expect(bestActiveStreak(habits, frozen)).toBe(23);
    // And the number the summary used to show, for the same data.
    expect(bestActiveStreak(habits)).toBe(18);
    // The card's own call, which was always correct.
    expect(calculateStreak(completions, daysAgo(18))).toBe(23);
  });

  it("ignores a frozen date belonging to a different habit", () => {
    const habits = [{ id: "a", completions: [daysAgo(0), daysAgo(2)] }];
    expect(bestActiveStreak(habits, { b: daysAgo(1) })).toBe(1);
  });

  it("skips habits with no completions rather than throwing", () => {
    const habits = [{ id: "a" }, { id: "b", completions: [daysAgo(0)] }];
    expect(bestActiveStreak(habits)).toBe(1);
  });
});
