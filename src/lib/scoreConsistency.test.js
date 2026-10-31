import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { format, subDays } from "date-fns";
import { dayNumber, getAllTimeBest, calculateStats, scoreFromParts } from "./utils";

/**
 * The two places the client used to disagree with the server about a
 * user's own numbers.
 *
 * This matters because of where the two meet. Every leaderboard draws the
 * viewer's own row from calculateStats, client-side, and every other row
 * from user_profiles.best_streak / .consistency_score, written by
 * sync_profile_stats_from_habits. So the viewer was ranked against the
 * field by a formula that differed from the one applied to the field --
 * and the differences are invisible from the timezone this is developed
 * in, which has no DST.
 */

const day = (n) => format(subDays(new Date(), n), "yyyy-MM-dd");

describe("dayNumber", () => {
  it("counts whole days, not elapsed milliseconds", () => {
    expect(dayNumber("2026-01-02") - dayNumber("2026-01-01")).toBe(1);
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-28")).toBe(1); // 2026 is not a leap year
    expect(dayNumber("2027-01-01") - dayNumber("2026-12-31")).toBe(1);
  });

  it("is NaN for an unparseable value, so a run simply breaks", () => {
    // Legacy/imported junk in completions must not crash a score.
    expect(Number.isNaN(dayNumber("not-a-date"))).toBe(true);
    expect(getAllTimeBest(["2026-01-01", "garbage", "2026-01-02"])).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Each pair is a real DST transition: the two local midnights that are 23
 * or 25 hours apart in that zone, which is what the old Date subtraction
 * measured.
 */
const DST_ZONES = [
  ["America/New_York", ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"], ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]],
  ["Europe/Berlin", ["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"], ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]],
  ["Australia/Sydney", ["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07"], ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]],
];

describe("getAllTimeBest across DST transitions", () => {
  const originalTZ = process.env.TZ;
  afterAll(() => { process.env.TZ = originalTZ; });

  for (const [zone, spring, autumn] of DST_ZONES) {
    it(`counts a 5-day run correctly in ${zone}`, () => {
      process.env.TZ = zone;
      // Guard: if the runtime ignores TZ this test would pass vacuously,
      // since the machine's own zone may have no DST. Assert the clock
      // actually moved before trusting the result.
      const janOffset = new Date("2026-01-15T12:00:00").getTimezoneOffset();
      const julOffset = new Date("2026-07-15T12:00:00").getTimezoneOffset();
      if (janOffset === julOffset) {
        // TZ did not take effect in this runtime; dayNumber is timezone
        // independent by construction, so verify that directly instead of
        // reporting a pass we did not earn.
        expect(dayNumber(spring[4]) - dayNumber(spring[0])).toBe(4);
        expect(dayNumber(autumn[4]) - dayNumber(autumn[0])).toBe(4);
        return;
      }
      expect(getAllTimeBest(spring)).toBe(5);
      expect(getAllTimeBest(autumn)).toBe(5);
    });
  }

  it("still breaks a run on a genuine gap", () => {
    expect(getAllTimeBest(["2026-06-01", "2026-06-02", "2026-06-04", "2026-06-05"])).toBe(2);
  });

  it("treats a duplicated date as one day, like the server's DISTINCT", () => {
    expect(getAllTimeBest(["2026-06-01", "2026-06-01", "2026-06-02"])).toBe(2);
  });
});

describe("calculateStats consistency rounds once, like the server", () => {
  /** round(avg(pct)) -- sync_profile_stats_from_habits, ported faithfully. */
  function serverConsistency(activeHabits) {
    if (!activeHabits.length) return 0;
    const last30 = Array.from({ length: 30 }, (_, i) => day(i));
    const pcts = activeHabits.map(
      (h) => (last30.filter((d) => (h.completions || []).includes(d)).length / 30) * 100
    );
    return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  }

  const habitWith = (k) => ({ archived: false, completions: Array.from({ length: k }, (_, i) => day(i)) });

  it("matches the server for the case that used to differ", () => {
    // 0 and 2 completions: true average 3.33%. Rounding each habit first
    // gave (0 + 7) / 2 = 3.5 -> 4%; the server says 3%.
    const habits = [habitWith(0), habitWith(2)];
    expect(calculateStats(habits).consistency).toBe(3);
    expect(calculateStats(habits).consistency).toBe(serverConsistency(habits));
  });

  it("matches the server for every two-habit combination", () => {
    const mismatches = [];
    for (let a = 0; a <= 30; a++) {
      for (let b = 0; b <= 30; b++) {
        const habits = [habitWith(a), habitWith(b)];
        const client = calculateStats(habits).consistency;
        const server = serverConsistency(habits);
        if (client !== server) mismatches.push(`${a},${b}: client ${client} vs server ${server}`);
      }
    }
    expect(
      mismatches.slice(0, 5),
      `${mismatches.length} of 961 combinations disagree with ` +
      "sync_profile_stats_from_habits. The viewer's own row would be " +
      "ranked by a different formula from everyone else's."
    ).toEqual([]);
  });
});

describe("scoreFromParts", () => {
  it("is the weighting the whole app uses", () => {
    expect(scoreFromParts(10, 50)).toBe(70);
  });

  it("treats missing parts as zero, as the server columns can be null", () => {
    expect(scoreFromParts(null, undefined)).toBe(0);
    expect(scoreFromParts(undefined, 40)).toBe(40);
  });

  it("agrees with calculateStats's own score", () => {
    // rollingBest, not bestStreak: the score's form term is the 90-day
    // rolling best. Passing bestStreak here used to be equivalent and
    // still passes for this fixture, because a 3-day run IS the all-time
    // best -- which is precisely why it is the wrong field to assert on.
    // The second fixture below has the two genuinely differ.
    const habits = [{ archived: false, completions: [day(0), day(1), day(2)] }];
    const s = calculateStats(habits);
    expect(s.score).toBe(scoreFromParts(s.rollingBest, s.consistency, s.witness));
  });

  it("builds the score from rolling form, not the all-time best", () => {
    // A 40-day run that ended over 90 days ago, plus a 3-day run now.
    // bestStreak is 40 and rollingBest is 3; the score must follow the 3.
    const habits = [{
      archived: false,
      completions: [
        ...Array.from({ length: 40 }, (_, i) => day(200 + i)),
        day(0), day(1), day(2),
      ],
    }];
    const s = calculateStats(habits);
    expect(s.bestStreak).toBe(40);
    expect(s.rollingBest).toBe(3);
    expect(s.score).toBe(scoreFromParts(3, s.consistency, 0));
    expect(s.score).not.toBe(scoreFromParts(40, s.consistency, 0));
  });
});
