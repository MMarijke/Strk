import { supabase } from "@/api/supabaseClient";
import { db, getCursor, setCursor, getOwner, mirrorStore } from "./db";
import {
  OP,
  STATUS,
  duePending,
  failedCount,
  markDone,
  markFailed,
  pendingCount,
} from "./outbox";
import { HABITS, OFFLINE_TABLES, offlineConfig } from "./tables";

/**
 * The sync engine.
 *
 * Push replays the outbox to Supabase; pull merges server changes into
 * Dexie. Both run under one guard, because two concurrent runs replaying
 * the same outbox entry is how a single check-in becomes two.
 *
 * No Background Sync API: iOS does not implement it. Sync is triggered
 * from the app instead -- see startSyncTriggers.
 */

// ------------------------------------------------------------- status

const listeners = new Set();
let state = { running: false, pending: 0, failed: 0, lastError: null, lastSyncedAt: null };

export function getSyncState() {
  return state;
}

export function onSyncState(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error("sync: listener failed", err);
    }
  }
}

async function refreshCounts() {
  setState({ pending: await pendingCount(), failed: await failedCount() });
}

// ------------------------------------------------------------- push

/**
 * Apply one set-member change to Supabase.
 *
 * Read-modify-write, because PostgREST cannot express array_append in an
 * update and this deliberately adds no RPC yet. It is safe for the case
 * that matters -- two devices adding different days -- precisely because
 * it RE-READS at push time: device A pushes Monday, the row now has
 * Monday; device B pushes Tuesday, reads Monday, writes Monday+Tuesday.
 * Neither is lost.
 *
 * The residual race is two pushes interleaving between the read and the
 * write, which needs both devices online in the same few hundred
 * milliseconds. The verify below catches it and re-throws so the entry is
 * retried rather than silently dropped. OFFLINE.md proposes the atomic
 * array_append RPC as the hardening step; it needs a migration, so it is
 * not applied here.
 */
async function pushSetMember(entry) {
  const { table, rowId, column, member, op } = entry;

  const { data: current, error: readError } = await supabase
    .from(table)
    .select(`id, ${column}`)
    .eq("id", rowId)
    .maybeSingle();
  if (readError) throw readError;

  // The row is gone -- deleted on another device. Dropping the member
  // change is correct: there is nothing to add it to, and recreating the
  // row from a check-in would resurrect a habit the user deleted.
  if (!current) return;

  const set = new Set(current[column] ?? []);
  if (op === OP.SET_ADD) set.add(member);
  else set.delete(member);

  const next = [...set].sort();
  const { data: written, error: writeError } = await supabase
    .from(table)
    .update({ [column]: next })
    .eq("id", rowId)
    .select(`id, ${column}`)
    .single();
  if (writeError) throw writeError;

  // Verify the intent actually took. Catches the interleaving race above.
  const after = new Set(written?.[column] ?? []);
  const wanted = op === OP.SET_ADD;
  if (after.has(member) !== wanted) {
    throw new Error(
      `set ${op} for ${member} did not take on ${table}:${rowId} -- concurrent write, will retry`
    );
  }
}

async function pushEntry(entry) {
  const { table, rowId, op, payload } = entry;

  switch (op) {
    case OP.INSERT: {
      // upsert, not insert: replaying an insert after a push that
      // succeeded but whose response was lost must not create a second
      // row or fail on the primary key.
      const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
      if (error) throw error;
      return;
    }

    case OP.PATCH: {
      const { error } = await supabase.from(table).update(payload).eq("id", rowId);
      if (error) throw error;
      return;
    }

    case OP.DELETE: {
      const { error } = await supabase.from(table).delete().eq("id", rowId);
      if (error) throw error;
      return;
    }

    case OP.SET_ADD:
    case OP.SET_REMOVE:
      await pushSetMember(entry);
      return;

    default:
      // An unknown op cannot be retried into working. Parking it stops it
      // blocking everything queued behind it.
      throw new Error(`unknown outbox operation: ${op}`);
  }
}

/** Replay the outbox in order. Stops at the first failure. */
async function push() {
  const entries = await duePending();

  for (const entry of entries) {
    try {
      await pushEntry(entry);
      await markDone(entry.seq);
    } catch (err) {
      await markFailed(entry.seq, err);
      // Stop rather than continue. Entries for one row are ordered, and
      // skipping a failed insert to apply the patch behind it targets a
      // row that does not exist.
      throw err;
    }
  }
}

// ------------------------------------------------------------- pull

/**
 * `supabase.from()` for a table name only known at runtime.
 *
 * supabase-js derives row types from a *literal* table name. Handed a
 * plain `string` it recurses over every table in the generated schema
 * and the checker gives up (TS2589). The set of mirrored tables is
 * configured at runtime by design, so this cast is the honest escape --
 * the justified `any` CLAUDE.md asks for, kept to one line instead of
 * spreading through the queries.
 */
function fromTable(table) {
  return /** @type {any} */ (supabase).from(table);
}

/**
 * Merge server rows for one table into Dexie.
 *
 * Conflict rule is last-write-wins by `updated_at`, with one exception
 * that matters: a local row with pending outbox entries is NOT
 * overwritten. The server copy does not yet contain those changes, so
 * taking it would visibly revert the user's own unsynced work.
 *
 * `updated_at` is set by a server-side trigger, so it records when the
 * row reached Supabase rather than when the user edited it. An offline
 * edit pushed later therefore carries a LATER stamp than a newer edit
 * made elsewhere, and wins when it should lose. That is a real hole, and
 * the fix is the proposed `client_updated_at` column -- see OFFLINE.md.
 * It is called out here because this is the line that would be wrong.
 */
async function pullTable(table, ownerId) {
  const config = offlineConfig(table);
  if (!config?.read) return;

  const cursor = await getCursor(table);

  let query = fromTable(table).select("*").eq(config.ownerColumn, ownerId);
  if (cursor) query = query.gt("updated_at", cursor);

  const { data: rows, error } = await query;
  if (error) throw error;

  // Rows with unsynced local changes, which the merge must not clobber.
  const blocked = new Set(
    (await db.outbox.where("status").anyOf(STATUS.PENDING, STATUS.FAILED).toArray())
      .filter((e) => e.table === table)
      .map((e) => e.rowId)
  );

  const store = mirrorStore(table);
  if (rows.length) {
    await db.transaction("rw", store, async () => {
      for (const row of rows) {
        if (blocked.has(row.id)) continue;
        await store.put(row);
      }
    });

    const newest = rows
      .map((r) => r.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    await setCursor(table, newest);
  }

  // Prune rows deleted elsewhere.
  //
  // Needed because deletes are HARD -- no table has deleted_at -- so a
  // row removed on another device simply stops appearing and an
  // incremental pull can never notice. One id-only query is cheap and is
  // the only way to converge without soft deletes. OFFLINE.md proposes
  // deleted_at, which would make this unnecessary.
  const { data: ids, error: idError } = await fromTable(table)
    .select("id")
    .eq(config.ownerColumn, ownerId);
  if (idError) throw idError;

  const live = new Set(ids.map((r) => r.id));
  const localIds = await store.toCollection().primaryKeys();
  const stale = localIds.filter((id) => !live.has(id) && !blocked.has(id));
  if (stale.length) await store.bulkDelete(stale);
}

async function pull(ownerId) {
  for (const table of Object.keys(OFFLINE_TABLES)) {
    await pullTable(table, ownerId);
  }
}

// ------------------------------------------------------------- run

let inFlight = null;

/**
 * One sync pass: push, then pull.
 *
 * Push first, so the pull cannot overwrite a local row whose change has
 * not left the device yet -- and so the pull sees the user's own writes
 * reflected rather than merging around them.
 *
 * Concurrency is a single in-flight promise rather than a boolean flag.
 * A flag lets a second caller return immediately while the first is still
 * running, so `await syncNow()` resolves before the work is done -- which
 * is wrong for the "sync after each local write" trigger and for tests.
 * Sharing the promise makes every caller wait for the same pass.
 */
export async function syncNow({ reason = "manual" } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Not an error, and not worth a failed attempt against the backoff.
      await refreshCounts();
      return { skipped: "offline" };
    }

    const ownerId = await getOwner();
    if (!ownerId) {
      await refreshCounts();
      return { skipped: "no-owner" };
    }

    setState({ running: true, lastError: null });
    try {
      await push();
      await pull(ownerId);
      setState({ lastSyncedAt: new Date().toISOString(), lastError: null });
      return { ok: true, reason };
    } catch (err) {
      setState({ lastError: String(err?.message ?? err) });
      return { error: err };
    } finally {
      setState({ running: false });
      await refreshCounts();
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// ------------------------------------------------------------- triggers

const PERIODIC_MS = 60_000;

/**
 * Wire the triggers. Returns a teardown function.
 *
 * Deliberately NOT the Background Sync API: iOS does not support it, and
 * a sync path that only works on Android is worse than one that works
 * everywhere while the app is open.
 */
export function startSyncTriggers() {
  if (typeof window === "undefined") return () => {};

  const run = (reason) => () => {
    syncNow({ reason }).catch(() => {
      // syncNow already records the error in state; this catch exists so
      // a listener never sees an unhandled rejection.
    });
  };

  const onOnline = run("online");
  const onVisible = () => {
    if (document.visibilityState === "visible") run("visible")();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const interval = setInterval(run("interval"), PERIODIC_MS);

  run("startup")();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(interval);
  };
}

/**
 * Nudge a sync after a local write, when online.
 *
 * Fire-and-forget on purpose: a write must never wait on the network, and
 * the whole point of the outbox is that it does not have to.
 */
export function syncAfterWrite() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  syncNow({ reason: "after-write" }).catch(() => {});
}

export { HABITS };
