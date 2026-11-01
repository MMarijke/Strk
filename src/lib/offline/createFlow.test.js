import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

import { db, clearLocalData, setOwner } from "./db";
import { Habit } from "@/api/entities";

/**
 * The create path, end to end through the entities seam.
 *
 * Separate from sync.test.js because it exercises what the Dashboard
 * actually calls -- `Habit.create(data)` followed by the refetch of
 * `Habit.filter({ created_by: email })` -- rather than the engine's
 * internals. That pair is where an optimistically created habit can
 * disappear: the query filters on the email column, and the server is
 * the only thing that fills it in.
 */

const OWNER = "22222222-2222-2222-2222-222222222222";
const EMAIL = "someone@example.com";

// Offline by default: the create path must not depend on the network.
let onLine = false;

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    from: () => {
      throw new Error("the offline create path must not reach Supabase");
    },
  },
}));

beforeEach(async () => {
  onLine = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
  await clearLocalData();
  await setOwner(OWNER, { email: EMAIL, full_name: "Someone" });
});

describe("creating a habit offline", () => {
  it("resolves rather than hanging", async () => {
    const created = await Habit.create({
      name: "Read",
      color: "#ff0000",
      frequency: "daily",
      completions: [],
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Read");
  });

  it("appears in the refetch the Dashboard actually runs", async () => {
    await Habit.create({ name: "Read", frequency: "daily", completions: [] });

    // Exactly what Dashboard.jsx's habits query calls.
    const rows = await Habit.filter({ created_by: EMAIL }, "-created_date");

    expect(rows.map((r) => r.name)).toEqual(["Read"]);
  });

  it("does not leak into another user's refetch", async () => {
    await Habit.create({ name: "Read", frequency: "daily", completions: [] });

    const rows = await Habit.filter({ created_by: "someone-else@example.com" });

    expect(rows).toEqual([]);
  });

  it("fills in the column defaults Postgres would have applied", async () => {
    const created = await Habit.create({ name: "Read", frequency: "daily" });
    const stored = await db.habits.get(created.id);

    expect(stored.completions).toEqual([]);
    expect(stored.archived).toBe(false);
    expect(stored.created_by_id).toBe(OWNER);
  });

  it("stamps the server-controlled email column, which every read filters on", async () => {
    const created = await Habit.create({ name: "Read", frequency: "daily" });
    const stored = await db.habits.get(created.id);

    expect(stored.created_by).toBe(EMAIL);
  });

  it("refuses to store a row no read could ever see", async () => {
    await clearLocalData();

    await expect(Habit.create({ name: "Read", frequency: "daily" })).rejects.toThrow(
      /not scoped/
    );
  });

  it("queues one insert carrying the whole row", async () => {
    const created = await Habit.create({ name: "Read", frequency: "daily" });
    const queued = await db.outbox.toArray();

    expect(queued).toHaveLength(1);
    expect(queued[0].op).toBe("insert");
    expect(queued[0].payload.id).toBe(created.id);
    expect(queued[0].payload.name).toBe("Read");
  });

  it("can be checked in straight away, with no sync in between", async () => {
    const created = await Habit.create({ name: "Read", frequency: "daily" });

    await Habit.update(created.id, { completions: ["2026-11-01"] });

    const rows = await Habit.filter({ created_by: EMAIL });
    expect(rows[0].completions).toEqual(["2026-11-01"]);
  });
});
