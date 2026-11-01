import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

import { db, clearLocalData, setOwner } from "./db";
import { canAnswerLocally } from "./tables";
import { Habit, UserProfile } from "@/api/entities";

/**
 * What the mirror is allowed to answer.
 *
 * The mirror is scoped to one user, so it can only answer questions
 * about that user. The regression this file exists for: a populated
 * mirror is treated as authoritative, so serving
 * `UserProfile.list("-best_streak")` from it returned a population of
 * ONE -- the viewer, ranked first by definition -- to Social, Badges and
 * Dashboard, while perfectly online.
 */

const OWNER = "66666666-6666-6666-6666-666666666666";
const EMAIL = "viewer@example.com";

let onLine = true;
let served;

vi.mock("@/api/supabaseClient", () => {
  const builder = (table) => {
    const q = {
      _table: table,
      _filters: {},
      select() {
        return this;
      },
      eq(col, val) {
        this._filters[col] = val;
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      contains() {
        return this;
      },
      or() {
        return this;
      },
      update(payload) {
        served.push({ table: this._table, op: "update", payload });
        const row = (SERVER[this._table] ?? []).find((r) => r.id === this._filters.id);
        return {
          eq: (col, val) => {
            this._filters[col] = val;
            return this.update(payload);
          },
          select: () => ({
            single: async () =>
              onLine
                ? { data: { ...(row ?? { id: "unknown" }), ...payload }, error: null }
                : { data: null, error: new Error("offline") },
          }),
        };
      },
      then(onOk, onErr) {
        served.push({ table: this._table, filters: { ...this._filters } });
        if (!onLine) {
          return Promise.resolve({ data: null, error: new Error("offline") }).then(onOk, onErr);
        }
        return Promise.resolve({ data: SERVER[this._table] ?? [], error: null }).then(onOk, onErr);
      },
    };
    return q;
  };
  return { supabase: { from: (table) => builder(table) } };
});

/** What the server would return: the viewer plus two public strangers. */
const SERVER = {
  user_profiles: [
    { id: "p-self", created_by_id: OWNER, created_by: EMAIL, best_streak: 4, plan: "free" },
    { id: "p-a", created_by_id: "other-a", created_by: "a@example.com", best_streak: 30 },
    { id: "p-b", created_by_id: "other-b", created_by: "b@example.com", best_streak: 12 },
  ],
  habits: [],
};

beforeEach(async () => {
  onLine = true;
  served = [];
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
  await clearLocalData();
  await setOwner(OWNER, { email: EMAIL, full_name: "Viewer" });
  // A populated mirror -- the state in which the bug appeared.
  await db.user_profiles.put(SERVER.user_profiles[0]);
});

describe("canAnswerLocally", () => {
  it("allows any read of a table the mirror holds completely", () => {
    expect(canAnswerLocally("habits", null)).toBe(true);
    expect(canAnswerLocally("habits", { created_by: EMAIL })).toBe(true);
  });

  it("refuses an unscoped read of a table the mirror only partly holds", () => {
    expect(canAnswerLocally("user_profiles", null)).toBe(false);
    expect(canAnswerLocally("user_profiles", {})).toBe(false);
  });

  it("allows a read of that table that pins the owner", () => {
    expect(canAnswerLocally("user_profiles", { created_by: EMAIL })).toBe(true);
    expect(canAnswerLocally("user_profiles", { created_by_id: OWNER })).toBe(true);
  });

  it("refuses $or rather than inspecting it", () => {
    expect(canAnswerLocally("user_profiles", { $or: [{ created_by: EMAIL }] })).toBe(false);
  });

  it("refuses a table that is not mirrored at all", () => {
    expect(canAnswerLocally("groups", null)).toBe(false);
    expect(canAnswerLocally("groups", { created_by: EMAIL })).toBe(false);
  });
});

describe("the leaderboard population", () => {
  it("is the server's, not the mirror's one row", async () => {
    const profiles = await UserProfile.list("-best_streak");

    expect(profiles).toHaveLength(3);
    expect(served.map((c) => c.table)).toContain("user_profiles");
  });

  it("is not quietly reduced to the viewer by a populated mirror", async () => {
    const profiles = await UserProfile.list("-best_streak");

    // The bug: a single row, the viewer, top of a leaderboard of one.
    expect(profiles.map((p) => p.id)).not.toEqual(["p-self"]);
  });

  it("is honestly unavailable offline rather than wrong", async () => {
    onLine = false;

    await expect(UserProfile.list("-best_streak")).rejects.toThrow();
  });
});

describe("the viewer's own profile", () => {
  it("still comes from the mirror, which is what works offline", async () => {
    onLine = false;

    const rows = await UserProfile.filter({ created_by: EMAIL });

    expect(rows.map((r) => r.id)).toEqual(["p-self"]);
    expect(served).toHaveLength(0);
  });

  it("prefers the server while online, for billing", async () => {
    await UserProfile.filter({ created_by: EMAIL }, undefined, { fresh: true });

    expect(served.map((c) => c.table)).toEqual(["user_profiles"]);
  });
});

describe("a write to a row the mirror has not pulled yet", () => {
  // The window between a first load (served from the network, because an
  // empty mirror means "never synced") and the first pull completing. A
  // user tapping a habit they can plainly see must not be told it didn't
  // save.
  it("goes to the server while online", async () => {
    SERVER.habits = [
      { id: "h-remote", created_by_id: OWNER, created_by: EMAIL, name: "Walk", completions: [] },
    ];

    await Habit.update("h-remote", { completions: ["2026-11-01"] });

    expect(served.map((c) => c.table)).toContain("habits");
    SERVER.habits = [];
  });

  it("still fails offline, where there is nothing to fall back to", async () => {
    onLine = false;

    await expect(Habit.update("h-missing", { name: "x" })).rejects.toThrow(/local store/);
    expect(served).toHaveLength(0);
  });

  it("does not queue an outbox entry it cannot compute a delta for", async () => {
    onLine = false;

    await Habit.update("h-missing", { completions: ["2026-11-01"] }).catch(() => {});

    // A patch carrying a whole array with no baseline is the check-in
    // loss the delta design exists to prevent.
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("habits", () => {
  it("are served from the mirror, since the mirror is all of them", async () => {
    await db.habits.put({
      id: "h1",
      created_by_id: OWNER,
      created_by: EMAIL,
      name: "Read",
      completions: [],
    });

    const rows = await Habit.filter({ created_by: EMAIL }, "-created_date");

    expect(rows.map((r) => r.name)).toEqual(["Read"]);
    expect(served).toHaveLength(0);
  });
});
