import { describe, it, expect, afterEach } from "vitest";
import { annualSavingsPct, prefersReducedMotion } from "./utils";

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

describe("prefersReducedMotion", () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = realMatchMedia; });

  it("reports the preference when the OS asks for reduced motion", () => {
    window.matchMedia = (q) => ({ matches: q === "(prefers-reduced-motion: reduce)" });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("reports no preference when the query does not match", () => {
    window.matchMedia = () => ({ matches: false });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("defaults to showing motion where matchMedia is unavailable, rather than throwing", () => {
    // An old browser or a bare test environment must still get the
    // celebration, not a crash on the completion screen.
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});
