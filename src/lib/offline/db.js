import Dexie from "dexie";

/**
 * The local mirror.
 *
 * Three stores:
 *
 *   habits, user_profiles  mirrors of the Supabase tables, keyed by the
 *                          same uuid, so a row is the same row locally
 *                          and remotely and an upsert is idempotent.
 *
 *   outbox                 pending local writes, in order.
 *
 *   meta                   sync cursors and the owning user id.
 *
 * Indexes are chosen for the two queries that actually run:
 * "all my rows" (`created_by_id`) and "what changed since" (`updated_at`).
 * Dexie needs each one declared; an unindexed filter falls back to a full
 * table scan, which on a habit list is fine and on the outbox is not.
 */
/**
 * Dexie's stores are declared at runtime, so `db.habits` is invisible to
 * the checker without this. Typed explicitly rather than cast to `any`:
 * a wrong column name in a query should still be caught.
 *
 * @typedef {Record<string, unknown> & { id: string }} MirrorRow
 * @typedef {{
 *   seq?: number,
 *   table: string,
 *   rowId: string,
 *   op: string,
 *   payload?: unknown,
 *   column?: string,
 *   member?: string,
 *   status: string,
 *   attempts: number,
 *   lastError: string | null,
 *   createdAt: string,
 *   nextAttemptAt: number,
 * }} OutboxEntry
 * @typedef {{ key: string, value: unknown }} MetaRow
 *
 * @typedef {Dexie & {
 *   habits: import("dexie").Table<MirrorRow, string>,
 *   user_profiles: import("dexie").Table<MirrorRow, string>,
 *   outbox: import("dexie").Table<OutboxEntry, number>,
 *   meta: import("dexie").Table<MetaRow, string>,
 * }} StrkDb
 */

/** @type {StrkDb} */
export const db = /** @type {StrkDb} */ (new Dexie("strk-offline"));

/**
 * The mirror store for a table name resolved at runtime.
 *
 * A helper rather than `db[table]`, which the typedef above cannot
 * express without an index signature that would erase the named stores.
 */
export function mirrorStore(table) {
  const store = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (db))[table];
  if (!store) throw new Error(`no local store for table: ${table}`);
  return /** @type {import("dexie").Table<MirrorRow, string>} */ (store);
}

db.version(1).stores({
  // `id` is the Supabase uuid, not an auto-increment. That is what makes
  // push idempotent: replaying an insert upserts the same row rather than
  // creating a second one.
  habits: "id, created_by_id, updated_at",
  user_profiles: "id, created_by_id, updated_at",

  // ++seq gives a strict FIFO order, which the push loop depends on: a
  // create followed by an update to the same row must not be replayed
  // the other way round.
  outbox: "++seq, status, table, rowId, createdAt",

  meta: "key",
});

/**
 * Everything the local store holds for a given user, cleared.
 *
 * Called on explicit sign-out only -- never on a failed token refresh,
 * which offline looks exactly like. Wiping the mirror because the network
 * dropped would delete unsynced check-ins, which is the worst thing this
 * layer could do.
 */
export async function clearLocalData() {
  await db.transaction("rw", db.habits, db.user_profiles, db.outbox, db.meta, async () => {
    await Promise.all([
      db.habits.clear(),
      db.user_profiles.clear(),
      db.outbox.clear(),
      db.meta.clear(),
    ]);
  });
}

// ----------------------------------------------------------------- meta

const OWNER_KEY = "ownerUserId";
const IDENTITY_KEY = "ownerIdentity";

/** The user id the local data belongs to, or null. */
export async function getOwner() {
  const row = await db.meta.get(OWNER_KEY);
  return row?.value ?? null;
}

/**
 * The owner's id, email and name, or null.
 *
 * Stored alongside the id because two separate things need it and
 * neither can get it from the network:
 *
 *   - An optimistically created row has to carry the owner's EMAIL, not
 *     just the id. `habits.created_by` is stamped server-side from the
 *     JWT, and every habit query in the app filters on it, so a local
 *     row without it is invisible to the query that created it.
 *
 *   - A cold start with no network has to resolve who is signed in
 *     without asking Supabase. See AuthContext: the stored session
 *     cannot be verified offline, and without this the app shows
 *     "couldn't verify your session" instead of opening.
 *
 * Only ever written from a session Supabase already verified. It is an
 * identity cache, not an authorization decision: every server call still
 * carries the real JWT and is still checked by RLS.
 */
export async function getOwnerIdentity() {
  const [id, identity] = await Promise.all([getOwner(), db.meta.get(IDENTITY_KEY)]);
  if (!id) return null;
  const value = /** @type {{ email?: string | null, full_name?: string | null }} */ (
    identity?.value ?? {}
  );
  return { id, email: value.email ?? null, full_name: value.full_name ?? null };
}

/**
 * Record the owner, wiping first if it changed.
 *
 * Two different people signing into the same browser must not see each
 * other's habits. Dexie has no RLS, so this is the only thing enforcing
 * that -- and it has to happen before the first read, not after.
 */
export async function setOwner(userId, identity) {
  const current = await getOwner();
  if (current && current !== userId) {
    await clearLocalData();
  }
  if (userId) {
    await db.meta.put({ key: OWNER_KEY, value: userId });
    if (identity) {
      await db.meta.put({
        key: IDENTITY_KEY,
        value: { email: identity.email ?? null, full_name: identity.full_name ?? null },
      });
    }
  }
}

/** The owner's email, for stamping optimistic rows. */
export async function getOwnerEmail() {
  const identity = await getOwnerIdentity();
  return identity?.email ?? null;
}

const cursorKey = (table) => `cursor:${table}`;

/** ISO timestamp of the newest row pulled for a table, or null. */
export async function getCursor(table) {
  const row = await db.meta.get(cursorKey(table));
  return row?.value ?? null;
}

export async function setCursor(table, iso) {
  if (!iso) return;
  await db.meta.put({ key: cursorKey(table), value: iso });
}

const syncedAtKey = (table) => `syncedAt:${table}`;

/**
 * When a table last completed a pull, or null.
 *
 * Distinct from the cursor, which holds the newest `updated_at` among the
 * rows pulled -- that is a property of the DATA and does not move when a
 * pull returns nothing. This is a property of the SYNC, and it is what
 * answers "how old is what we are showing", which is the question
 * subscription state has to ask before it trusts a cached `plan`.
 */
export async function getSyncedAt(table) {
  const row = await db.meta.get(syncedAtKey(table));
  const value = row?.value;
  return typeof value === "string" ? value : null;
}

export async function setSyncedAt(table, iso = new Date().toISOString()) {
  await db.meta.put({ key: syncedAtKey(table), value: iso });
}

/**
 * Reset a table's cursor so the next pull is a full one.
 *
 * Used after a merge that could have been incomplete, and by the tests.
 */
export async function resetCursor(table) {
  await db.meta.delete(cursorKey(table));
}
