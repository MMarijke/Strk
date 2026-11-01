import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// Reached only through localFilter's import chain; no test here touches it.
vi.mock("@/api/supabaseClient", () => ({ supabase: { from: () => ({}) } }));

import { db, clearLocalData, setOwner, setSyncedAt, getSyncedAt } from "./db";
import {
  SUBSCRIPTION_MAX_AGE_MS,
  getCachedSubscription,
  resolveCachedPlan,
} from "./subscription";

/**
 * How far a cached paid plan is trusted.
 *
 * This is the rule that decides whether somebody gets what they paid
 * for, so it is tested as a pure function rather than through the hook:
 * both directions matter and both are cheap to state here.
 */

const OWNER = "55555555-5555-5555-5555-555555555555";
const EMAIL = "payer@example.com";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

const ago = (ms) => new Date(NOW - ms).toISOString();

describe("resolveCachedPlan", () => {
  it("honours a plan cached today", () => {
    expect(resolveCachedPlan({ plan: "pro", syncedAt: ago(0), now: NOW })).toMatchObject({
      isPro: true,
      expired: false,
    });
  });

  it("honours a plan cached six days ago -- a week offline is not a cancellation", () => {
    expect(resolveCachedPlan({ plan: "pro", syncedAt: ago(6 * DAY), now: NOW })).toMatchObject({
      isPro: true,
      expired: false,
    });
  });

  it("stops honouring it past the maximum age", () => {
    const past = ago(SUBSCRIPTION_MAX_AGE_MS + 1000);
    expect(resolveCachedPlan({ plan: "pro", syncedAt: past, now: NOW })).toMatchObject({
      isPro: false,
      expired: true,
    });
  });

  it("refuses a paid plan with no sync to date it by", () => {
    // Fail closed: no cached evidence is not evidence of Pro.
    expect(resolveCachedPlan({ plan: "pro", syncedAt: null, now: NOW })).toMatchObject({
      isPro: false,
      expired: true,
    });
  });

  it("refuses a paid plan dated by an unparseable stamp", () => {
    expect(resolveCachedPlan({ plan: "pro", syncedAt: "not a date", now: NOW })).toMatchObject({
      isPro: false,
      expired: true,
    });
  });

  it("does not expire a plan because the device clock ran backwards", () => {
    const future = new Date(NOW + 5 * DAY).toISOString();
    expect(resolveCachedPlan({ plan: "pro", syncedAt: future, now: NOW })).toMatchObject({
      isPro: true,
      expired: false,
    });
  });

  it("never reports expiry for a free plan -- there is nothing to expire", () => {
    expect(resolveCachedPlan({ plan: "free", syncedAt: null, now: NOW })).toEqual({
      isPro: false,
      expired: false,
      ageMs: null,
    });
    expect(resolveCachedPlan({ plan: null, syncedAt: ago(90 * DAY), now: NOW })).toMatchObject({
      isPro: false,
      expired: false,
    });
  });

  it("is a week, stated once", () => {
    expect(SUBSCRIPTION_MAX_AGE_MS).toBe(7 * DAY);
  });
});

describe("getCachedSubscription", () => {
  beforeEach(async () => {
    await clearLocalData();
    await setOwner(OWNER, { email: EMAIL, full_name: "Payer" });
  });

  it("reads the mirrored plan and the mirror's age", async () => {
    await db.user_profiles.put({
      id: "p1",
      created_by_id: OWNER,
      created_by: EMAIL,
      plan: "pro",
    });
    await setSyncedAt("user_profiles", ago(2 * DAY));

    const cached = await getCachedSubscription(EMAIL);

    expect(cached.plan).toBe("pro");
    expect(Date.parse(cached.syncedAt)).toBe(NOW - 2 * DAY);
  });

  it("reports no plan when nothing has been mirrored", async () => {
    expect(await getCachedSubscription(EMAIL)).toEqual({ plan: null, syncedAt: null });
  });

  it("will not serve another user's cached plan", async () => {
    await db.user_profiles.put({
      id: "p2",
      created_by_id: "someone-else",
      created_by: "other@example.com",
      plan: "pro",
    });
    await setSyncedAt("user_profiles");

    expect((await getCachedSubscription("other@example.com")).plan).toBeNull();
  });
});

describe("the sync timestamp that dates it", () => {
  beforeEach(async () => {
    await clearLocalData();
  });

  it("is null until a pull has completed", async () => {
    expect(await getSyncedAt("user_profiles")).toBeNull();
  });

  it("is wiped with the rest of the local data on sign-out", async () => {
    await setSyncedAt("user_profiles");
    expect(await getSyncedAt("user_profiles")).not.toBeNull();

    await clearLocalData();

    // Otherwise the next user on a shared device inherits a freshness
    // claim about data that is no longer there.
    expect(await getSyncedAt("user_profiles")).toBeNull();
  });

  it("is recorded per table, not globally", async () => {
    await setSyncedAt("habits", ago(DAY));
    expect(await getSyncedAt("user_profiles")).toBeNull();
  });
});

describe("the hook's two cases", () => {
  it("dates a cached answer by the mirror, and a verified one not at all", () => {
    // The regression this guards: using the mirror's age for a verified
    // answer downgrades a paying user whose profile mirror has not
    // pulled yet, because syncedAt is null and null fails closed.
    const verified = { plan: "pro", syncedAt: null, verified: true };
    const cachedOnly = { plan: "pro", syncedAt: null, verified: false };

    const isPro = (d) =>
      d.verified
        ? d.plan === "pro"
        : resolveCachedPlan({ plan: d.plan, syncedAt: d.syncedAt, now: NOW }).isPro;

    expect(isPro(verified)).toBe(true);
    expect(isPro(cachedOnly)).toBe(false);
  });

  it("matches what useSubscription actually computes", async () => {
    // Pins the shape above to the hook's source rather than to a copy of
    // its logic: a test that agrees only with itself proves nothing.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/hooks/useSubscription.js", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).toMatch(/isPro: verified \? data\?\.plan === "pro" : cached\.isPro/);
    expect(source).toMatch(/fresh: true/);
  });
});
