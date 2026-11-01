import { db } from "./db";
import { offlineConfig } from "./tables";

/**
 * The queue of local writes waiting to reach Supabase.
 *
 * Operations, and why these and not just insert/update/delete:
 *
 *   insert         a whole new row
 *   patch          a partial update of scalar columns
 *   delete         removal by id
 *   set_add        add one member to a set column
 *   set_remove     remove one member from a set column
 *
 * set_add / set_remove exist because `habits.completions` is a text[] and
 * there is no check-in table. A `patch` carrying the whole completions
 * array is a last-write-wins write: two devices each log a different day
 * offline, both push their array, and one device's day is silently gone.
 * A per-member add is idempotent (adding a day twice is the same set) and
 * commutative (replay order does not matter), so nothing is lost no
 * matter how the two devices interleave.
 */
export const OP = {
  INSERT: "insert",
  PATCH: "patch",
  DELETE: "delete",
  SET_ADD: "set_add",
  SET_REMOVE: "set_remove",
};

export const STATUS = {
  PENDING: "pending",
  FAILED: "failed",
};

/**
 * Attempts before an entry is parked as failed.
 *
 * Parked rather than dropped: the local row keeps the user's change, and
 * the entry stays in the outbox so the UI can report it and offer a
 * retry. Silently discarding somebody's check-in after six tries would be
 * worse than telling them it did not save.
 */
export const MAX_ATTEMPTS = 6;

/** Exponential, capped. Index is the attempt count already made. */
export function backoffMs(attempts) {
  const base = 1000 * Math.pow(2, Math.min(attempts, 5));
  // Jitter, so N queued entries that all failed on the same network drop
  // do not retry in lockstep the moment it returns.
  return base + Math.floor(Math.random() * 500);
}

async function enqueue(entry) {
  await db.outbox.add({
    ...entry,
    status: STATUS.PENDING,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    nextAttemptAt: 0,
  });
}

export async function queueInsert(table, row) {
  await enqueue({ table, rowId: row.id, op: OP.INSERT, payload: row });
}

export async function queueDelete(table, rowId) {
  await enqueue({ table, rowId, op: OP.DELETE, payload: null });
}

/**
 * Turn a partial update into operations, splitting out set columns.
 *
 * `previous` is the local row before the change. It is required: the
 * delta for a set column can only be derived by comparing against what
 * was there, and without it the only honest fallback is a whole-array
 * patch, which is the data loss this function exists to avoid. A caller
 * with no previous row should be queueing an insert.
 *
 * Returns the operations queued, for the tests and for callers that want
 * to know whether anything actually changed.
 */
export async function queueUpdate(table, rowId, changes, previous) {
  const config = offlineConfig(table);
  const setColumns = config?.setColumns ?? [];
  const queued = [];

  const scalarChanges = {};
  for (const [column, value] of Object.entries(changes)) {
    if (!setColumns.includes(column)) {
      scalarChanges[column] = value;
      continue;
    }

    // A set column: diff it rather than carrying it.
    const before = new Set(previous?.[column] ?? []);
    const after = new Set(value ?? []);

    for (const member of after) {
      if (!before.has(member)) {
        queued.push({ table, rowId, op: OP.SET_ADD, column, member });
      }
    }
    for (const member of before) {
      if (!after.has(member)) {
        queued.push({ table, rowId, op: OP.SET_REMOVE, column, member });
      }
    }
  }

  if (Object.keys(scalarChanges).length > 0) {
    queued.push({ table, rowId, op: OP.PATCH, payload: scalarChanges });
  }

  for (const entry of queued) await enqueue(entry);
  return queued;
}

/**
 * Pending entries that are due, oldest first.
 *
 * Order matters and is the reason `seq` is an auto-increment: an insert
 * followed by a patch of the same row must replay in that order, or the
 * patch targets a row that does not exist yet.
 */
export async function duePending(now = Date.now()) {
  const pending = await db.outbox.where("status").equals(STATUS.PENDING).sortBy("seq");
  return pending.filter((e) => (e.nextAttemptAt ?? 0) <= now);
}

export async function pendingCount() {
  return db.outbox.where("status").equals(STATUS.PENDING).count();
}

export async function failedCount() {
  return db.outbox.where("status").equals(STATUS.FAILED).count();
}

export async function markDone(seq) {
  await db.outbox.delete(seq);
}

/**
 * Record a failure and schedule the retry, or park the entry.
 *
 * The error is stored as a string rather than the object: a Supabase
 * error is not structured-cloneable in every browser, and an IndexedDB
 * write that throws while recording a failure loses the entry entirely.
 */
export async function markFailed(seq, error) {
  const entry = await db.outbox.get(seq);
  if (!entry) return;

  const attempts = (entry.attempts ?? 0) + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  await db.outbox.update(seq, {
    attempts,
    lastError: String(error?.message ?? error ?? "unknown error"),
    status: exhausted ? STATUS.FAILED : STATUS.PENDING,
    nextAttemptAt: exhausted ? 0 : Date.now() + backoffMs(attempts),
  });
}

/**
 * Move every failed entry back to pending, due immediately.
 *
 * What the "Retry" affordance on a sync error calls. Attempts are reset
 * so the user gets a full set of tries again rather than one.
 */
export async function retryFailed() {
  const failed = await db.outbox.where("status").equals(STATUS.FAILED).toArray();
  await Promise.all(
    failed.map((e) =>
      db.outbox.update(e.seq, { status: STATUS.PENDING, attempts: 0, nextAttemptAt: 0 })
    )
  );
  return failed.length;
}
