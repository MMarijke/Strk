import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";

import { db, clearLocalData, setOwner, getCursor, setCursor } from "./db";
import {
  MAX_ATTEMPTS,
  OP,
  STATUS,
  backoffMs,
  duePending,
  failedCount,
  markFailed,
  pendingCount,
  queueUpdate,
  retryFailed,
} from "./outbox";
import { localCreate, localDelete, localFilter, localList, localUpdate } from "./localStore";

/**
 * Sync engine tests.
 *
 * Supabase is mocked at the client boundary rather than the network: the
 * point is to exercise the engine's decisions -- replay order,
 * idempotence, the completions delta, the cursor, the offline
 * transition -- not PostgREST's wire format.
 *
 * fake-indexeddb gives Dexie a real IndexedDB implementation under
 * jsdom, which has none. Without it every one of these fails on
 * `indexedDB is not defined` rather than on anything meaningful.
 */

const OWNER = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------- mock

/** Server state the mock reads and writes, so a push is observable. */
let server;
/** Every call the engine made, for asserting idempotence and order. */
let calls;
/** Set to make the next write fail, for retry and backoff tests. */
let failNextWrites = 0;
/** Backs the navigator.onLine spy. */
let onLine = false;

vi.mock("@/api/supabaseClient", () => {
  const builder = (table) => {
    const q = {
      _table: table,
      _filters: {},
      _select: null,
      select(cols) {
        this._select = cols;
        return this;
      },
      eq(col, val) {
        this._filters[col] = val;
        return this;
      },
      gt(col, val) {
        this._filters[`${col}>`] = val;
        return this;
      },
      maybeSingle() {
        return this._resolve(true);
      },
      single() {
        return this._resolve(true);
      },
      then(onOk, onErr) {
        return this._resolve(false).then(onOk, onErr);
      },
      async _resolve(single) {
        const rows = (server[this._table] ?? []).filter((r) => {
          for (const [k, v] of Object.entries(this._filters)) {
            if (k.endsWith(">")) {
              if (!(r[k.slice(0, -1)] > v)) return false;
            } else if (r[k] !== v) return false;
          }
          return true;
        });
        return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
      },
      upsert(payload) {
        calls.push({ op: "upsert", table: this._table, payload });
        if (failNextWrites > 0) {
          failNextWrites -= 1;
          return Promise.resolve({ data: null, error: new Error("network down") });
        }
        const list = (server[this._table] ??= []);
        const i = list.findIndex((r) => r.id === payload.id);
        const row = { ...payload, updated_at: new Date().toISOString() };
        if (i >= 0) list[i] = row;
        else list.push(row);
        return Promise.resolve({ data: [row], error: null });
      },
      update(payload) {
        calls.push({ op: "update", table: this._table, payload });
        if (failNextWrites > 0) {
          failNextWrites -= 1;
          return Promise.resolve({
            data: null,
            error: new Error("network down"),
            select: () => ({ single: async () => ({ data: null, error: new Error("network down") }) }),
          });
        }
        const self = this;
        const apply = () => {
          const list = server[self._table] ?? [];
          const target = list.find((r) => {
            for (const [k, v] of Object.entries(self._filters)) if (r[k] !== v) return false;
            return true;
          });
          if (target) Object.assign(target, payload, { updated_at: new Date().toISOString() });
          return target ?? null;
        };
        const result = {
          select() {
            return {
              async single() {
                return { data: apply(), error: null };
              },
            };
          },
          then(onOk, onErr) {
            apply();
            return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
          },
        };
        // Keep eq() chainable before .select()
        result.eq = (col, val) => {
          self._filters[col] = val;
          return result;
        };
        return result;
      },
      delete() {
        const self = this;
        const result = {
          eq(col, val) {
            self._filters[col] = val;
            return result;
          },
          then(onOk, onErr) {
            calls.push({ op: "delete", table: self._table, filters: { ...self._filters } });
            const list = server[self._table] ?? [];
            server[self._table] = list.filter((r) => {
              for (const [k, v] of Object.entries(self._filters)) if (r[k] !== v) return false;
              return false;
            });
            return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
          },
        };
        return result;
      },
    };
    return q;
  };

  return { supabase: { from: (table) => builder(table) } };
});

// Imported after the mock so the engine binds to it.
const { syncNow } = await import("./sync");

const habit = (over = {}) => ({
  name: "Read",
  created_by_id: OWNER,
  completions: [],
  archived: false,
  ...over,
});

beforeEach(async () => {
  server = { habits: [], user_profiles: [] };
  calls = [];
  failNextWrites = 0;
  await clearLocalData();
  await setOwner(OWNER);

  // Offline by DEFAULT, and every test that syncs calls goOnline() first.
  //
  // Not a convenience: localCreate/localUpdate call syncAfterWrite(),
  // which fires a real pass while online. Four tests in the first version
  // of this file failed because the row had already reached the mock
  // server before their assertions ran. Writing offline and then going
  // online is also exactly the flow the feature exists for, so the tests
  // read as the real sequence rather than around it.
  onLine = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
});

/** Flip to online. Returns nothing; call before an explicit syncNow(). */
function goOnline() {
  onLine = true;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- tests

describe("local writes are optimistic", () => {
  it("a created habit is readable immediately, before any sync", async () => {
    const row = await localCreate("habits", habit(), { completions: [], archived: false });
    expect(row.id).toBeTruthy();

    const local = await localList("habits");
    expect(local).toHaveLength(1);
    expect(local[0].name).toBe("Read");
    // Nothing has reached the server yet.
    expect(server.habits).toHaveLength(0);
    expect(await pendingCount()).toBe(1);
  });

  it("fills in the column defaults Postgres would have applied", async () => {
    // Without this the optimistic row has `completions: undefined` and
    // every stat function reading it breaks until the first sync.
    const row = await localCreate("habits", { name: "Walk", created_by_id: OWNER }, {
      completions: [],
      archived: false,
    });
    expect(row.completions).toEqual([]);
    expect(row.archived).toBe(false);
  });

  it("scopes reads to the owner, because Dexie has no RLS", async () => {
    await db.habits.put({ ...habit(), id: "mine" });
    await db.habits.put({ ...habit({ created_by_id: "someone-else" }), id: "theirs" });

    const local = await localList("habits");
    expect(local.map((r) => r.id)).toEqual(["mine"]);
  });
});

describe("outbox replay", () => {
  it("pushes a created habit to the server", async () => {
    await localCreate("habits", habit(), { completions: [] });
    goOnline();
    await syncNow();

    expect(server.habits).toHaveLength(1);
    expect(server.habits[0].name).toBe("Read");
    expect(await pendingCount()).toBe(0);
  });

  it("replays in order, so a patch never precedes its insert", async () => {
    const row = await localCreate("habits", habit(), { completions: [] });
    await localUpdate("habits", row.id, { name: "Read more" });

    goOnline();
    await syncNow();

    const ops = calls.map((c) => c.op);
    expect(ops.indexOf("upsert")).toBeLessThan(ops.indexOf("update"));
    expect(server.habits[0].name).toBe("Read more");
  });

  it("is idempotent: replaying an insert upserts rather than duplicating", async () => {
    const row = await localCreate("habits", habit(), { completions: [] });

    // First push succeeds server-side but the response is lost, so the
    // entry stays pending and is replayed.
    goOnline();
    await syncNow();
    await db.outbox.add({
      table: "habits",
      rowId: row.id,
      op: OP.INSERT,
      payload: { ...row, created_date: undefined },
      status: STATUS.PENDING,
      attempts: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: 0,
    });
    await syncNow();

    expect(server.habits).toHaveLength(1);
  });

  it("deletes propagate", async () => {
    const row = await localCreate("habits", habit(), { completions: [] });
    goOnline();
    await syncNow();
    expect(server.habits).toHaveLength(1);

    await localDelete("habits", row.id);
    await syncNow();

    expect(server.habits).toHaveLength(0);
    expect(await localList("habits")).toHaveLength(0);
  });
});

describe("check-ins are deltas, not whole arrays", () => {
  it("logging a day queues one set_add, not a patch", async () => {
    const row = await localCreate("habits", habit(), { completions: [] });
    await db.outbox.clear();

    const queued = await queueUpdate(
      "habits",
      row.id,
      { completions: ["2026-11-01"] },
      { ...row, completions: [] }
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ op: OP.SET_ADD, column: "completions", member: "2026-11-01" });
  });

  it("un-logging a day queues a set_remove", async () => {
    const queued = await queueUpdate(
      "habits",
      "h1",
      { completions: [] },
      { id: "h1", completions: ["2026-11-01"] }
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ op: OP.SET_REMOVE, member: "2026-11-01" });
  });

  it("splits a mixed update into deltas plus one scalar patch", async () => {
    const queued = await queueUpdate(
      "habits",
      "h1",
      { completions: ["a", "b"], name: "Renamed" },
      { id: "h1", completions: ["a"], name: "Old" }
    );

    const adds = queued.filter((q) => q.op === OP.SET_ADD).map((q) => q.member);
    const patches = queued.filter((q) => q.op === OP.PATCH);
    expect(adds).toEqual(["b"]);
    expect(patches).toHaveLength(1);
    // The patch must NOT carry completions -- that is the whole-array
    // write that loses the other device's check-in.
    expect(patches[0].payload).toEqual({ name: "Renamed" });
    expect(patches[0].payload.completions).toBeUndefined();
  });

  it("two devices logging different days both survive", async () => {
    // The headline case. Device A's row already reached the server with
    // Monday; device B, which synced before that, adds Tuesday.
    const row = await localCreate("habits", habit(), { completions: [] });
    goOnline();
    await syncNow();

    server.habits[0].completions = ["2026-11-02"]; // device A, already pushed
    await localUpdate("habits", row.id, { completions: ["2026-11-03"] }); // device B
    await syncNow();

    expect(server.habits[0].completions.sort()).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("adding a day twice is a no-op on the server", async () => {
    const row = await localCreate("habits", habit(), { completions: [] });
    goOnline();
    await syncNow();

    await localUpdate("habits", row.id, { completions: ["2026-11-01"] });
    await syncNow();
    // Replay the same add.
    await db.outbox.add({
      table: "habits",
      rowId: row.id,
      op: OP.SET_ADD,
      column: "completions",
      member: "2026-11-01",
      status: STATUS.PENDING,
      attempts: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: 0,
    });
    await syncNow();

    expect(server.habits[0].completions).toEqual(["2026-11-01"]);
  });
});

describe("retries and backoff", () => {
  it("keeps the entry pending and backs off after a failure", async () => {
    await localCreate("habits", habit(), { completions: [] });
    failNextWrites = 1;

    goOnline();
    await syncNow();

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe(STATUS.PENDING);
    expect(entries[0].attempts).toBe(1);
    expect(entries[0].lastError).toContain("network down");
    // Scheduled into the future, so the next pass does not hammer it.
    expect(entries[0].nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("does not retry an entry before its backoff elapses", async () => {
    await localCreate("habits", habit(), { completions: [] });
    failNextWrites = 1;
    goOnline();
    await syncNow();

    expect(await duePending(Date.now())).toHaveLength(0);
    expect(await duePending(Date.now() + 10 * 60_000)).toHaveLength(1);
  });

  it("backs off exponentially and caps", () => {
    expect(backoffMs(0)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(4));
    // Capped, so a long-dead entry does not schedule itself days out.
    expect(backoffMs(20)).toBeLessThan(40_000);
  });

  it("parks an entry as failed after MAX_ATTEMPTS and surfaces it", async () => {
    await localCreate("habits", habit(), { completions: [] });
    const [entry] = await db.outbox.toArray();

    for (let i = 0; i < MAX_ATTEMPTS; i++) await markFailed(entry.seq, new Error("nope"));

    expect(await failedCount()).toBe(1);
    expect(await pendingCount()).toBe(0);
    // Parked, not dropped: the user's change is still in the local row
    // and the entry is still there to report and retry.
    expect(await localList("habits")).toHaveLength(1);
  });

  it("retryFailed puts parked entries back in play immediately", async () => {
    await localCreate("habits", habit(), { completions: [] });
    const [entry] = await db.outbox.toArray();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markFailed(entry.seq, new Error("nope"));

    const revived = await retryFailed();

    expect(revived).toBe(1);
    expect(await failedCount()).toBe(0);
    expect(await duePending()).toHaveLength(1);
  });
});

describe("pull and the cursor", () => {
  it("merges server rows into the local store", async () => {
    server.habits.push({
      id: "remote-1",
      name: "From another device",
      created_by_id: OWNER,
      completions: ["2026-10-01"],
      archived: false,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });

    goOnline();
    await syncNow();

    const local = await localList("habits");
    expect(local.map((r) => r.name)).toEqual(["From another device"]);
  });

  it("advances the cursor to the newest row seen", async () => {
    expect(await getCursor("habits")).toBeNull();

    server.habits.push({
      id: "r1",
      created_by_id: OWNER,
      name: "a",
      completions: [],
      updated_at: "2026-10-01T00:00:00.000Z",
    });
    server.habits.push({
      id: "r2",
      created_by_id: OWNER,
      name: "b",
      completions: [],
      updated_at: "2026-10-05T00:00:00.000Z",
    });

    goOnline();
    await syncNow();

    expect(await getCursor("habits")).toBe("2026-10-05T00:00:00.000Z");
  });

  it("only asks for rows newer than the cursor", async () => {
    await setCursor("habits", "2026-10-03T00:00:00.000Z");
    server.habits.push({
      id: "old",
      created_by_id: OWNER,
      name: "old",
      completions: [],
      updated_at: "2026-10-01T00:00:00.000Z",
    });

    goOnline();
    await syncNow();

    // Filtered out by the cursor, so it never reaches the local store.
    expect(await localList("habits")).toHaveLength(0);
  });

  it("does not overwrite a row whose local change has not pushed yet", async () => {
    // The revert bug this guards: the server copy does not contain the
    // user's edit yet, so merging it would visibly undo their work.
    //
    // Constructing that state takes care. The obvious version -- edit
    // locally, then sync -- does not exercise it at all: push runs before
    // pull, so the edit is already on the server by the time pull looks,
    // and the test passes for the wrong reason. The first version of this
    // test did exactly that, and removing the protection it was meant to
    // guard did not fail it.
    //
    // So: let the push FAIL once. The entry is then pending with a
    // backoff, push skips it on the next pass because it is not due, and
    // pull runs with a pending entry outstanding -- which is the only
    // situation where the skip matters.
    const row = await localCreate("habits", habit({ name: "Mine" }), { completions: [] });
    goOnline();
    await syncNow();

    // updated_at must advance, or the cursor filters this row out of the
    // pull entirely and the skip under test is never reached. (It was
    // not, in the previous version of this test.)
    server.habits[0] = {
      ...server.habits[0],
      name: "Server version",
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };

    failNextWrites = 1;
    await localUpdate("habits", row.id, { name: "My offline edit" });
    await syncNow(); // push fails, entry parked with a backoff

    const [queued] = await db.outbox.toArray();
    expect(queued.status).toBe(STATUS.PENDING);
    expect(queued.nextAttemptAt).toBeGreaterThan(Date.now());

    // This pass pushes nothing (not due) and pulls.
    await syncNow();

    const local = await localList("habits");
    expect(local[0].name).toBe("My offline edit");
  });

  it("prunes rows deleted on another device", async () => {
    // Deletes are hard -- no deleted_at anywhere -- so an incremental
    // pull cannot see them and the id reconcile is the only way to
    // converge.
    server.habits.push({
      id: "gone-soon",
      created_by_id: OWNER,
      name: "x",
      completions: [],
      updated_at: "2026-10-01T00:00:00.000Z",
    });
    goOnline();
    await syncNow();
    expect(await localList("habits")).toHaveLength(1);

    server.habits = [];
    await syncNow();

    expect(await localList("habits")).toHaveLength(0);
  });
});

describe("offline to online", () => {
  it("skips the pass while offline and leaves the queue intact", async () => {
    await localCreate("habits", habit(), { completions: [] });
    const result = await syncNow();

    expect(result).toEqual({ skipped: "offline" });
    expect(server.habits).toHaveLength(0);
    // No attempt was spent against the backoff -- being offline is not a
    // failure.
    const [entry] = await db.outbox.toArray();
    expect(entry.attempts).toBe(0);
  });

  it("drains everything queued offline once connectivity returns", async () => {
    const a = await localCreate("habits", habit({ name: "One" }), { completions: [] });
    await localCreate("habits", habit({ name: "Two" }), { completions: [] });
    await localUpdate("habits", a.id, { completions: ["2026-11-01"] });
    expect(await pendingCount()).toBe(3);

    goOnline();
    await syncNow();

    expect(await pendingCount()).toBe(0);
    expect(server.habits).toHaveLength(2);
    const pushed = server.habits.find((h) => h.name === "One");
    expect(pushed.completions).toEqual(["2026-11-01"]);
  });

  it("does nothing when no owner is recorded", async () => {
    // Fail-closed: a sync with no owner would pull with an undefined
    // filter, which on a real client is every readable row.
    await db.meta.clear();
    goOnline();
    expect(await syncNow()).toEqual({ skipped: "no-owner" });
  });
});

describe("concurrency", () => {
  it("two overlapping calls share one pass", async () => {
    await localCreate("habits", habit(), { completions: [] });

    goOnline();
    const [a, b] = await Promise.all([syncNow(), syncNow()]);

    // Same result object: the second caller joined the first pass rather
    // than starting a second replay of the same outbox entry, which is
    // how one check-in becomes two.
    expect(a).toBe(b);
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(1);
  });
});

describe("the local filter DSL", () => {
  it("supports equality and array-contains, AND-ed", async () => {
    await db.habits.put({ ...habit(), id: "h1", category: "health", completions: ["d1"] });
    await db.habits.put({ ...habit(), id: "h2", category: "fitness", completions: [] });

    expect((await localFilter("habits", { category: "health" })).map((r) => r.id)).toEqual(["h1"]);
    expect(
      (await localFilter("habits", { completions: { $in: ["d1"] } })).map((r) => r.id)
    ).toEqual(["h1"]);
  });

  it("throws on a condition it cannot honour rather than returning everything", async () => {
    // Silently ignoring an unsupported condition would return rows the
    // caller did not ask for, past the owner scope.
    await db.habits.put({ ...habit(), id: "h1" });
    await expect(localFilter("habits", { name: { $gt: "a" } })).rejects.toThrow(/unsupported/);
  });
});
