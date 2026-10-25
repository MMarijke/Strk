import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  isPartnerNoticeDismissed, dismissPartnerNotice,
  isScopeNoticeDismissed, dismissScopeNotice,
} from "./partnerNotice";

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

describe("scope notice dismissal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is not dismissed until it is", () => {
    expect(isScopeNoticeDismissed("p1")).toBe(false);
    dismissScopeNotice("p1");
    expect(isScopeNoticeDismissed("p1")).toBe(true);
  });

  // Keyed by id, not a boolean: a different partnership is a different
  // relationship, and its scope notice is its own decision.
  it("does not carry a dismissal across partnerships", () => {
    dismissScopeNotice("p1");
    expect(isScopeNoticeDismissed("p2")).toBe(false);
  });

  // The two notices share a module but must not share a key -- dismissing
  // "Jordan declined" must not silently suppress "you're already sharing".
  it("is independent of the declined/ended notice", () => {
    dismissPartnerNotice("p1");
    expect(isScopeNoticeDismissed("p1")).toBe(false);
    dismissScopeNotice("p1");
    expect(isPartnerNoticeDismissed("p1")).toBe(true);
  });

  it("treats a missing id as not dismissed and ignores a write for one", () => {
    expect(isScopeNoticeDismissed(null)).toBe(false);
    expect(isScopeNoticeDismissed(undefined)).toBe(false);
    expect(() => dismissScopeNotice(null)).not.toThrow();
  });

  it("degrades to not-dismissed when storage throws, as in a private window", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isScopeNoticeDismissed("p1")).toBe(false);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => dismissScopeNotice("p1")).not.toThrow();
    setItem.mockRestore();
  });
});
