/**
 * Which tables are mirrored offline, and how.
 *
 * Opt-in by design. Mirroring all twenty tables would be wrong: groups,
 * challenges, focus sessions, reactions and nudges are inherently
 * multi-party and online -- a cached "who is in this focus session right
 * now" is worse than an honest empty state, and several of them reject
 * client writes outright (see OFFLINE.md, Known RLS blockers).
 *
 * The stated goal is narrower than "everything": load the app, show habit
 * data, create/edit/delete habits and log check-ins with no network. That
 * needs exactly two tables.
 *
 *   read   the table is pulled into Dexie and served from there
 *   write  local writes are applied optimistically and queued in the outbox
 *
 * A table with `read` but not `write` still reaches Supabase for writes
 * and so still fails offline -- deliberately, for rows whose only
 * writable columns are server-derived anyway.
 */

/** The user's own habits. The whole point of the feature. */
export const HABITS = "habits";

/**
 * The viewer's own profile row.
 *
 * Read-only offline. Its interesting columns -- best_streak,
 * rolling_best_streak_90, consistency_score, witness_slots -- are
 * server-derived and already blocked from client writes by
 * protect_user_profiles_stats_fields, so queueing an offline write to
 * them would produce an outbox entry that can only ever fail. The
 * client-writable ones (display_name, is_public, email_weekly_digest) are
 * settings changes, which are a reasonable thing to require a connection
 * for.
 *
 * Cached because Dashboard, Badges and Social all read it on mount, and
 * without it the app shell renders with no score, no tier and no name.
 */
export const USER_PROFILES = "user_profiles";

export const OFFLINE_TABLES = {
  [HABITS]: {
    read: true,
    write: true,
    /**
     * Scope for both the pull query and the local read.
     *
     * habits_select_own is `created_by_id = auth.uid()`, so the server
     * would filter this anyway -- but the local store has no RLS, and a
     * row left behind from a previous session on a shared device must not
     * be served to the next user. Every local read is scoped by the same
     * key.
     */
    ownerColumn: "created_by_id",
    /**
     * The denormalized email mirror of ownerColumn.
     *
     * `habits.created_by` is server-controlled -- stamped from the JWT by
     * stamp_created_by_email() on insert and pinned on update, after it
     * was found to be forgeable (20260914090001). The client cannot set
     * it, so nothing fills it in on a row that has not reached the
     * server yet.
     *
     * It still has to be on the optimistic row, because every habit
     * query in the app filters by it -- Dashboard's own refetch is
     * `filter({ created_by: user.email })`. Without it a habit created
     * offline is invisible to the query that just created it: the write
     * succeeds, the list never shows it, and it only appears after a
     * sync replaces the local row with the server's copy. Stamped from
     * the owner identity cached in `meta`, which is the same email the
     * server's trigger will write, so the two agree.
     */
    ownerEmailColumn: "created_by",
    /**
     * Columns holding a set whose members are added and removed
     * individually, rather than a value that is replaced.
     *
     * This is the single most important line in the offline layer.
     * `completions` is a text[] on the habit row and there is no check-in
     * table, so a row-level last-write-wins merge DESTROYS check-ins: two
     * devices each log a different day, both push the whole row, one
     * day is gone. Columns listed here are diffed into per-member add and
     * remove operations instead, which are idempotent and commutative.
     */
    setColumns: ["completions"],
  },

  [USER_PROFILES]: {
    read: true,
    write: false,
    ownerColumn: "created_by_id",
    setColumns: [],
  },
};

export function offlineConfig(table) {
  return OFFLINE_TABLES[table] ?? null;
}

export function isOfflineReadable(table) {
  return Boolean(OFFLINE_TABLES[table]?.read);
}

export function isOfflineWritable(table) {
  return Boolean(OFFLINE_TABLES[table]?.write);
}
