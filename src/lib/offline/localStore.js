import { db, getOwner, getOwnerEmail } from "./db";
import { offlineConfig } from "./tables";
import { queueDelete, queueInsert, queueUpdate } from "./outbox";
import { syncAfterWrite } from "./sync";

/**
 * The local-first implementations of the entity methods.
 *
 * These are what `createEntity` delegates to for a table listed in
 * tables.js. Keeping them here rather than inline in entities.js keeps
 * that file readable as the Supabase adapter it has always been, and
 * means the offline layer can be deleted in one directory if it ever
 * needs to be.
 *
 * Every read is scoped by owner. Dexie has no RLS, so a row left behind
 * by a previous session on a shared device would otherwise be served to
 * whoever signs in next -- the one security property this file is
 * responsible for.
 */

/** Same `created_date` alias entities.js adds, so callers cannot tell. */
function mapRow(row) {
  if (!row) return row;
  return { ...row, created_date: row.created_at };
}

function compare(a, b, field, descending) {
  const av = a?.[field];
  const bv = b?.[field];
  if (av === bv) return 0;
  // Nulls last regardless of direction: a row with no value is not
  // "earliest", it is unknown, and burying it matches what PostgREST does
  // for `nullsFirst: false`, which is its default for .order().
  if (av == null) return 1;
  if (bv == null) return -1;
  return (av < bv ? -1 : 1) * (descending ? -1 : 1);
}

const SORT_FIELD_ALIASES = { created_date: "created_at" };

function applySort(rows, sort) {
  if (!sort) return rows;
  const descending = sort.startsWith("-");
  const raw = descending ? sort.slice(1) : sort;
  const field = SORT_FIELD_ALIASES[raw] || raw;
  return [...rows].sort((a, b) => compare(a, b, field, descending));
}

/**
 * The subset of the entities query DSL that the local store answers.
 *
 * Equality and array-contains, AND-ed; plus `$or` of those. That is the
 * whole DSL as actually used in this codebase (entities.js documents the
 * same three shapes), so an unsupported condition is a bug rather than a
 * missing feature -- and it throws rather than silently returning
 * everything, which would leak another user's rows past the owner scope.
 */
function matches(row, conditions) {
  if (conditions.$or) {
    return conditions.$or.some((c) => matches(row, c));
  }
  return Object.entries(conditions).every(([field, value]) => {
    if (value && typeof value === "object") {
      if ("$in" in value) {
        const column = row?.[field];
        if (!Array.isArray(column)) return false;
        return value.$in.every((v) => column.includes(v));
      }
      throw new Error(`offline filter: unsupported condition on "${field}"`);
    }
    return row?.[field] === value;
  });
}

async function ownedRows(table) {
  const config = offlineConfig(table);
  const owner = await getOwner();
  // No owner means nothing has been synced for anybody yet. Returning []
  // rather than every row is the fail-closed choice.
  if (!owner) return [];
  return db[table].where(config.ownerColumn).equals(owner).toArray();
}

export async function localList(table, sort, limit) {
  const rows = applySort(await ownedRows(table), sort);
  const limited = typeof limit === "number" ? rows.slice(0, limit) : rows;
  return limited.map(mapRow);
}

export async function localFilter(table, conditions = {}, sort) {
  const rows = (await ownedRows(table)).filter((r) => matches(r, conditions));
  return applySort(rows, sort).map(mapRow);
}

export async function localGet(table, id) {
  const row = await db[table].get(id);
  if (!row) return null;
  const owner = await getOwner();
  const config = offlineConfig(table);
  // Scoped even for a direct id read: an id is guessable and the local
  // store will not stop you.
  if (owner && row[config.ownerColumn] && row[config.ownerColumn] !== owner) return null;
  return row;
}

/**
 * Create locally, queue the insert, return the optimistic row.
 *
 * The id is generated here rather than by the server, which is what makes
 * the push an idempotent upsert on a key both sides already agree on. The
 * column defaults Postgres would have applied are filled in locally too
 * -- otherwise the optimistic row is missing `completions` and
 * `archived`, and the UI renders a habit with no completions array at
 * all until the first sync.
 */
export async function localCreate(table, data, defaults = {}) {
  const config = offlineConfig(table);
  const [owner, ownerEmail] = await Promise.all([getOwner(), getOwnerEmail()]);
  const now = new Date().toISOString();

  const row = {
    ...defaults,
    ...data,
    id: data.id ?? crypto.randomUUID(),
    [config.ownerColumn]: data[config.ownerColumn] ?? owner,
    created_at: data.created_at ?? now,
    updated_at: now,
  };

  // The email mirror of the owner column. Server-controlled, so the row
  // would otherwise reach the local store without it and be invisible to
  // every read that filters by email -- including the one the UI runs
  // immediately after this returns. See tables.js:ownerEmailColumn.
  if (config.ownerEmailColumn) {
    row[config.ownerEmailColumn] = row[config.ownerEmailColumn] ?? ownerEmail;
  }

  // Fail loudly rather than storing a row no read can ever see. An
  // unqueryable local row looks exactly like a create that silently did
  // nothing, which is how this was found.
  if (!row[config.ownerColumn]) {
    throw new Error(`offline create: no owner for ${table} -- local store is not scoped yet`);
  }

  await db[table].put(row);
  await queueInsert(table, row);
  syncAfterWrite();
  return mapRow(row);
}

/**
 * Update locally, queue the delta, return the optimistic row.
 *
 * The previous row is read first and handed to queueUpdate, because a set
 * column's delta can only be derived by comparing against what was there.
 * Without it the only honest fallback is pushing the whole array, which
 * is the check-in loss the whole design avoids.
 */
export async function localUpdate(table, id, changes) {
  const previous = await localGet(table, id);
  if (!previous) {
    // Nothing local to update. Queueing a patch for a row the device has
    // never seen would push changes computed from no baseline.
    throw new Error(`offline update: ${table}:${id} is not in the local store`);
  }

  const next = { ...previous, ...changes, updated_at: new Date().toISOString() };
  await db[table].put(next);
  await queueUpdate(table, id, changes, previous);
  syncAfterWrite();
  return mapRow(next);
}

export async function localDelete(table, id) {
  await db[table].delete(id);
  await queueDelete(table, id);
  syncAfterWrite();
}
