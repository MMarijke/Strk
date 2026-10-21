import { describe, it, expect } from "vitest";
import { annualSavingsPct, assignCompetitionRanks, ordinal } from "./utils";

// Paddle price objects always look like { unit_price: { amount, currency_code } },
// amount in cents as a string (matching Paddle's own API response shape).
function price(amountCents) {
  return { unit_price: { amount: String(amountCents), currency_code: "USD" } };
}

describe("annualSavingsPct", () => {
  it("computes the real percentage saved by paying annually instead of monthly", () => {
    // $2.99/mo * 12 = $35.88/yr vs a $19.99/yr price -> ~44% saved
    expect(annualSavingsPct(price(299), price(1999))).toBe(44);
  });

  it("returns 0 (not null) when annual costs exactly 12x monthly -- no savings, but a real answer", () => {
    expect(annualSavingsPct(price(1000), price(12000))).toBe(0);
  });

  it("returns a negative number if annual is somehow pricier than 12x monthly", () => {
    // Not expected to happen in practice, but the formula shouldn't silently
    // clamp or hide this -- a pricing-page reader deserves the real number.
    expect(annualSavingsPct(price(1000), price(13200))).toBe(-10);
  });

  it("returns null when either price is missing", () => {
    expect(annualSavingsPct(null, price(1999))).toBeNull();
    expect(annualSavingsPct(price(299), null)).toBeNull();
    expect(annualSavingsPct(undefined, undefined)).toBeNull();
  });

  it("returns null when a price object is present but has no unit_price (still loading)", () => {
    expect(annualSavingsPct({}, price(1999))).toBeNull();
  });

  it("returns null when a price amount is zero", () => {
    expect(annualSavingsPct(price(0), price(1999))).toBeNull();
  });
});

describe("assignCompetitionRanks", () => {
  // Shorthand: a list of scores in the order a leaderboard would already
  // have sorted them, descending.
  const rank = (...scores) => assignCompetitionRanks(scores.map((score, i) => ({ id: i, score })));

  it("gives distinct scores sequential places", () => {
    expect(rank(30, 20, 10).map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("gives equal scores the same place, and skips the places the tie consumed", () => {
    // The bug this replaces: these two 20s used to become 2nd and 3rd,
    // decided by arrival order, and the 10 came 4th either way.
    expect(rank(30, 20, 20, 10).map((e) => e.rank)).toEqual([1, 2, 2, 4]);
  });

  it("handles a tie at the top -- two crowns, not a crown and a silver medal", () => {
    expect(rank(30, 30, 10).map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it("handles every score being equal", () => {
    expect(rank(5, 5, 5).map((e) => e.rank)).toEqual([1, 1, 1]);
    expect(rank(5, 5, 5).every((e) => e.isTied)).toBe(true);
  });

  it("marks only the entries actually sharing a place as tied", () => {
    expect(rank(30, 20, 20, 10).map((e) => e.isTied)).toEqual([false, true, true, false]);
  });

  it("handles two separate ties in one list", () => {
    const result = rank(30, 30, 20, 20, 10);
    expect(result.map((e) => e.rank)).toEqual([1, 1, 3, 3, 5]);
    expect(result.map((e) => e.isTied)).toEqual([true, true, true, true, false]);
  });

  it("never reports a non-numeric score as tied -- sharing an absence of data is not a tie", () => {
    // GroupDashboard uses score: null for a member whose profile isn't
    // readable. Two of them sort adjacently and would otherwise compare
    // equal (null === null), which would claim they had tied.
    const result = assignCompetitionRanks([
      { id: "a", score: 10 },
      { id: "b", score: null },
      { id: "c", score: null },
    ]);
    expect(result.map((e) => e.isTied)).toEqual([false, false, false]);
    // They still get positions, so the list keeps counting.
    expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("does not let a non-numeric score carry a tie across it", () => {
    // The 10 after the null must not be compared against the 10 before it.
    const result = assignCompetitionRanks([
      { id: "a", score: 10 },
      { id: "b", score: null },
      { id: "c", score: 10 },
    ]);
    expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(result.map((e) => e.isTied)).toEqual([false, false, false]);
  });

  it("handles zero as a real score rather than a missing one", () => {
    const result = rank(0, 0);
    expect(result.map((e) => e.rank)).toEqual([1, 1]);
    expect(result.every((e) => e.isTied)).toBe(true);
  });

  it("returns an empty list unchanged and a single entry as 1st, untied", () => {
    expect(assignCompetitionRanks([])).toEqual([]);
    expect(rank(42)).toEqual([{ id: 0, score: 42, rank: 1, isTied: false }]);
  });

  it("does not mutate the entries it is given", () => {
    const input = [{ id: "a", score: 10 }];
    assignCompetitionRanks(input);
    expect(input[0]).toEqual({ id: "a", score: 10 });
  });

  it("preserves every other field on each entry", () => {
    const result = assignCompetitionRanks([{ id: "a", score: 10, name: "Ana", isMe: true }]);
    expect(result[0].name).toBe("Ana");
    expect(result[0].isMe).toBe(true);
  });
});

describe("ordinal", () => {
  it("uses st/nd/rd for 1, 2, 3", () => {
    expect([1, 2, 3].map(ordinal)).toEqual(["1st", "2nd", "3rd"]);
  });

  it("uses th for 4 through 10", () => {
    expect([4, 5, 9, 10].map(ordinal)).toEqual(["4th", "5th", "9th", "10th"]);
  });

  it("uses th for the 11-13 exceptions rather than st/nd/rd", () => {
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });

  it("resumes st/nd/rd past the exceptions", () => {
    expect([21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(["21st", "22nd", "23rd", "101st", "111th", "112th"]);
  });
});
