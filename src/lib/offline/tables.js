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
     * The mirror holds everything the server would return for this
     * table, so an unscoped read can be answered locally.
     *
     * True here because habits_select_own is `created_by_id =
     * auth.uid()`: the owner's rows ARE the whole readable table. Not
     * true of user_profiles -- see its entry.
     */
    completeMirror: true,
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
    /**
     * FALSE, and this is load-bearing.
     *
     * user_profiles_select_public lets the client read every row with
     * `is_public = true`, not just its own -- and the leaderboards are
     * built on exactly that: `UserProfile.list("-best_streak")` in
     * Social, Badges and Dashboard is a POPULATION query. The pull only
     * fetches the owner's row, so the mirror is a strict subset of what
     * the server would answer.
     *
     * Serving an unscoped read from it therefore does not return stale
     * data, it returns a WRONG ANSWER: a population of one, the viewer,
     * ranked first by definition. And because a populated mirror is
     * authoritative, that answer would be given while perfectly online.
     * Badges' own percentile gate (`usersBelow > 0`) would hide it
     * rather than announce "top 100%", so it would have shown up as a
     * leaderboard that quietly lost everyone else.
     *
     * So reads of this table are served locally only when they pin the
     * owner -- the viewer's own profile, which is what Dashboard's score
     * and tier and useSubscription need offline. Anything asking about
     * other people goes to the network and is honestly unavailable
     * without one.
     */
    completeMirror: false,
    /**
     * Read scoping only, never stamping: this table is not offline
     * writable, so localCreate never runs for it.
     *
     * It is here because every real query for the viewer's own profile
     * is `filter({ created_by: email })` -- Dashboard's score and tier,
     * displayName, useSubscription. Without it, completeMirror: false
     * would send all three to the network and the profile would be
     * unavailable offline, which is most of what the mirror exists for.
     */
    ownerEmailColumn: "created_by",
    setColumns: [],
  },
};

/**
 * Whether the local store can answer this query at all.
 *
 * A mirror scoped to one user can only answer questions about that user.
 * `completeMirror` says the mirror is everything the server would return;
 * otherwise the query has to pin the owner column (or its email mirror)
 * for a local answer to be the same answer.
 *
 * `$or` is refused rather than inspected: a branch that does not pin the
 * owner widens the query past what the mirror holds, and no query in this
 * codebase needs it on a mirrored table.
 */
export function canAnswerLocally(table, conditions) {
  const config = offlineConfig(table);
  if (!config?.read) return false;
  if (config.completeMirror) return true;
  if (!conditions || conditions.$or) return false;

  return [config.ownerColumn, config.ownerEmailColumn]
    .filter(Boolean)
    .some((column) => typeof conditions[column] === "string" && conditions[column].length > 0);
}

export function offlineConfig(table) {
  return OFFLINE_TABLES[table] ?? null;
}

export function isOfflineReadable(table) {
  return Boolean(OFFLINE_TABLES[table]?.read);
}

export function isOfflineWritable(table) {
  return Boolean(OFFLINE_TABLES[table]?.write);
}
