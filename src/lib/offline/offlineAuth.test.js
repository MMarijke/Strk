import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { db, clearLocalData, getOwner, getOwnerEmail, getOwnerIdentity, setOwner } from "./db";

/**
 * Opening the app with no network.
 *
 * Supabase cannot verify a stored token offline, so getSession() either
 * times out or resolves with no session -- and both outcomes used to end
 * the cold start: one on "couldn't verify your session", the other on
 * Login, with the user's habits sitting unread in IndexedDB. The cached
 * identity in `meta` is what lets the app open instead.
 *
 * AuthContext itself is a component and this repo has no React testing
 * library, so the decision points there are asserted against its source
 * (comments stripped -- an assertion that matches the prose explaining a
 * guard passes whether or not the guard exists).
 */

const OWNER = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";

function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

beforeEach(async () => {
  await clearLocalData();
});

describe("the cached owner identity", () => {
  it("survives so a cold start can resolve who is signed in", async () => {
    await setOwner(OWNER, { email: "a@example.com", full_name: "Ada" });

    expect(await getOwnerIdentity()).toEqual({
      id: OWNER,
      email: "a@example.com",
      full_name: "Ada",
    });
  });

  it("is null when nobody has signed in, so the app still shows Login", async () => {
    expect(await getOwnerIdentity()).toBeNull();
  });

  it("is gone after an explicit sign-out", async () => {
    await setOwner(OWNER, { email: "a@example.com", full_name: "Ada" });
    await clearLocalData();

    expect(await getOwnerIdentity()).toBeNull();
    expect(await getOwner()).toBeNull();
  });

  it("does not survive a change of owner on a shared device", async () => {
    await setOwner(OWNER, { email: "a@example.com", full_name: "Ada" });
    await db.habits.put({ id: "h1", created_by_id: OWNER, created_by: "a@example.com" });

    await setOwner(OTHER, { email: "b@example.com", full_name: "Bo" });

    expect(await getOwnerEmail()).toBe("b@example.com");
    expect(await db.habits.count()).toBe(0);
  });

  it("keeps the id usable even if the identity payload was never written", async () => {
    // A store written by the phase-2 build, before identity existed.
    await setOwner(OWNER);

    expect(await getOwnerIdentity()).toEqual({ id: OWNER, email: null, full_name: null });
  });
});

describe("AuthContext's offline paths", () => {
  const source = sourceWithoutComments("src/lib/AuthContext.jsx");

  it("resumes from the cache instead of waiting out the offline timeout", () => {
    const start = source.indexOf("const startedOffline");
    const getSession = source.indexOf("supabase.auth.getSession()");

    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, getSession)).toMatch(/if \(startedOffline\)[\s\S]*resumeOfflineIdentity/);
  });

  it("prefers the cache over the session-check failure screen", () => {
    // Every setSessionCheckFailed(true) must be reachable only after a
    // resume was attempted and declined, or the failure screen wins the
    // race it used to win.
    const failures = source.split("setSessionCheckFailed(true)").length - 1;
    const guarded = source.split(/resumeOfflineIdentity\(\)[\s\S]{0,400}?setSessionCheckFailed\(true\)/)
      .length - 1;

    expect(failures).toBeGreaterThan(0);
    expect(guarded).toBe(failures - 1); // the one online-only path stays unguarded
  });

  it("treats a null session while offline as a resume, not a sign-out", () => {
    expect(source).toMatch(
      /if \(!nextUser && !signedOutRef\.current && isOffline\(\) && \(await resumeOfflineIdentity\(\)\)\)/
    );
  });

  it("cannot resume an identity an explicit sign-out just deleted", () => {
    const logout = source.indexOf("const logout = async");
    const wipe = source.indexOf("clearLocalData()", logout);
    const guard = source.indexOf("signedOutRef.current = true", logout);

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(wipe);
  });
});
