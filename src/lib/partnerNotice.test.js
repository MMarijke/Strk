import { describe, it, expect, afterEach, vi } from "vitest";
import { isPartnerNoticeDismissed, dismissPartnerNotice } from "./partnerNotice";

// The RPC wrappers in accountabilityService.js are not covered here: they
// are one-line passthroughs whose behaviour lives in
// 20260915090004_accountability_partner.sql, and testing them would mean
// asserting against a mock of Supabase rather than against anything real.
describe("partner notice dismissal", () => {
  afterEach(() => {
    try { localStorage.clear(); } catch { /* not available in this env */ }
    vi.restoreAllMocks();
  });

  it("reports not-dismissed before anything is stored", () => {
    expect(isPartnerNoticeDismissed("abc")).toBe(false);
  });

  it("round-trips a dismissal for the id it was given", () => {
    dismissPartnerNotice("abc");
    expect(isPartnerNoticeDismissed("abc")).toBe(true);
  });

  it("does not treat a different partnership as dismissed", () => {
    // The whole point of storing the id rather than a boolean: a new
    // partnership ending must produce a fresh notice.
    dismissPartnerNotice("abc");
    expect(isPartnerNoticeDismissed("def")).toBe(false);
  });

  it("only remembers the most recent dismissal", () => {
    dismissPartnerNotice("abc");
    dismissPartnerNotice("def");
    expect(isPartnerNoticeDismissed("def")).toBe(true);
    expect(isPartnerNoticeDismissed("abc")).toBe(false);
  });

  it("treats a missing id as not dismissed rather than matching a null key", () => {
    expect(isPartnerNoticeDismissed(null)).toBe(false);
    expect(isPartnerNoticeDismissed(undefined)).toBe(false);
  });

  it("is a no-op for a missing id rather than storing one", () => {
    dismissPartnerNotice(null);
    expect(isPartnerNoticeDismissed(null)).toBe(false);
  });

  it("degrades to not-dismissed when storage reads throw", () => {
    // A private window or blocked site data must not crash the panel on
    // render, which is the only place this is called from.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isPartnerNoticeDismissed("abc")).toBe(false);
  });

  it("swallows a failed write rather than throwing out of the click handler", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => dismissPartnerNotice("abc")).not.toThrow();
  });
});
