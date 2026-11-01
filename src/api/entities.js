import { supabase } from '@/api/supabaseClient';
import { isOfflineReadable, isOfflineWritable } from '@/lib/offline/tables';
import {
  localCreate,
  localDelete,
  localFilter,
  localList,
  localUpdate,
} from '@/lib/offline/localStore';

// Base44's implicit "created_date" field is our "created_at" column.
const SORT_FIELD_ALIASES = { created_date: 'created_at' };

// Every row gets a `created_date` alias added back on so any code that still
// reads the old Base44 implicit field name keeps working unchanged.
function mapRow(row) {
  if (!row) return row;
  return { ...row, created_date: row.created_at };
}

function applySort(query, sort) {
  if (!sort) return query;
  const descending = sort.startsWith('-');
  const rawField = descending ? sort.slice(1) : sort;
  const field = SORT_FIELD_ALIASES[rawField] || rawField;
  return query.order(field, { ascending: !descending });
}

// Quote values so they survive PostgREST's comma/dot/paren-sensitive filter
// grammar unscathed — every value used in this app is an email, uuid, or
// simple scalar, so this is a safety net rather than a general-purpose parser.
function escapeFilterValue(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// Base44's query DSL, as actually used across this codebase, is just:
//   { field: value, ... }                      -> AND of equality checks
//   { field: { '$in': [value] } }               -> array column contains value
//   { '$or': [ {field: value}, {field: {...}} ] } -> OR of the two shapes above
function applyCondition(query, field, value) {
  if (value && typeof value === 'object' && '$in' in value) {
    return query.contains(field, value['$in']);
  }
  return query.eq(field, value);
}

function buildOrFragment(condition) {
  const [field, value] = Object.entries(condition)[0];
  if (value && typeof value === 'object' && '$in' in value) {
    const items = value['$in'].map(escapeFilterValue).join(',');
    return `${field}.cs.{${items}}`;
  }
  return `${field}.eq.${escapeFilterValue(value)}`;
}

/**
 * Column defaults Postgres would apply on insert.
 *
 * Needed only for offline-writable tables: an optimistically created row
 * never reaches the server, so nothing fills these in, and the UI would
 * render a habit whose `completions` is undefined rather than [].
 */
const LOCAL_INSERT_DEFAULTS = {
  habits: { completions: [], archived: false, reminder_days: [] },
};

/**
 * The Supabase adapter, with a local-first path for the tables listed in
 * lib/offline/tables.js.
 *
 * The local path lives behind this function rather than in the 46
 * useQuery call sites across 20 files. Those all go through these methods
 * already, so inserting the offline layer here serves reads from
 * IndexedDB and makes writes optimistic without touching a single
 * component -- and without discarding the invalidateQueries logic already
 * threaded through every mutation path, which stays the reactivity
 * mechanism.
 *
 * Reads fall back to the network when the local store has nothing yet, so
 * a first-ever load still works before the first sync has populated
 * anything.
 */
function createEntity(table) {
  const offlineRead = isOfflineReadable(table);
  const offlineWrite = isOfflineWritable(table);

  return {
    // `limit` is optional and was added because UserProfile.list() was
    // unbounded: Badges.jsx fetched every readable profile on every visit
    // just to compute one percentile. RLS already restricts the rows to
    // public profiles, but "every public profile" grows without limit and
    // the screen needs a sample, not the census.
    async list(sort, limit) {
      if (offlineRead) {
        const local = await localList(table, sort, limit);
        // A populated local store is authoritative; an empty one may just
        // mean "never synced", so fall through to the network rather than
        // reporting no data on a first load.
        if (local.length) return local;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return local;
      }
      let query = supabase.from(table).select('*');
      query = applySort(query, sort);
      if (typeof limit === 'number') query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data.map(mapRow);
    },

    /**
     * `options.fresh` asks for the server's answer rather than the
     * mirror's, and falls back to the mirror if the network fails.
     *
     * Needed because a mirrored read is authoritative by default, which
     * is right for habit data and wrong for billing: the webhook that
     * flips `plan` to pro lands on the server, and a client reading its
     * local copy would keep reporting `free` to a customer who has just
     * paid, until the next pull happened to run.
     *
     * A failed network read throws rather than quietly serving the
     * mirror. Whether cached state may stand in depends on what is being
     * read -- for billing it depends on how old that state is -- and
     * this adapter is the wrong place to decide it. See
     * lib/offline/subscription.js.
     */
    async filter(conditions = {}, sort, { fresh = false } = {}) {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const preferNetwork = fresh && online;

      if (offlineRead && !preferNetwork) {
        const local = await localFilter(table, conditions, sort);
        if (local.length) return local;
        if (!online) return local;
      }
      let query = supabase.from(table).select('*');
      if (conditions.$or) {
        query = query.or(conditions.$or.map(buildOrFragment).join(','));
      } else {
        for (const [field, value] of Object.entries(conditions)) {
          query = applyCondition(query, field, value);
        }
      }
      query = applySort(query, sort);
      const { data, error } = await query;
      if (error) throw error;
      return data.map(mapRow);
    },

    async create(data) {
      if (offlineWrite) {
        return localCreate(table, data, LOCAL_INSERT_DEFAULTS[table]);
      }
      const { data: row, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
      return mapRow(row);
    },

    // Batched multi-row insert -- one round-trip instead of N separate
    // .create() calls in a Promise.all. .single() (used by create()
    // above) only accepts exactly one returned row, so this needs its own
    // method rather than a variadic version of create().
    async createMany(dataArray) {
      if (!dataArray.length) return [];
      const { data: rows, error } = await supabase.from(table).insert(dataArray).select();
      if (error) throw error;
      return rows.map(mapRow);
    },

    async update(id, data) {
      if (offlineWrite) {
        return localUpdate(table, id, data);
      }
      const { data: row, error } = await supabase.from(table).update(data).eq('id', id).select().single();
      if (error) throw error;
      return mapRow(row);
    },

    async delete(id) {
      if (offlineWrite) {
        return localDelete(table, id);
      }
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },
  };
}

export const Habit = createEntity('habits');
export const UserProfile = createEntity('user_profiles');
export const Group = createEntity('groups');
export const GroupChallenge = createEntity('group_challenges');
export const FocusSession = createEntity('focus_sessions');
export const Reaction = createEntity('reactions');
export const StreakFreeze = createEntity('streak_freezes');
export const UserBadge = createEntity('user_badges');
export const AccountabilityPartnership = createEntity('accountability_partnerships');
// Owner-only select (20261024090001). Writes have no policy at all and go
// through set_shared_habits / the invite + accept RPCs, so this is read-only
// in practice -- used by the requester to review their own pending offer.
export const AccountabilitySharedHabit = createEntity('accountability_shared_habits');
// Owner-only select (20261026090001); writes have no policy at all and go
// through link_challenge_habit, so this is read-only in practice -- used to
// show the viewer which of their own habits counts for a challenge.
export const ChallengeHabitLink = createEntity('challenge_habit_links');
// The same, for focus sessions (20261026090001). Owner-only select; writes
// go through link_focus_session_habit.
//
// Restored after the merge of main into this branch dropped it: #127 and
// this branch each added a line anchored immediately after
// AccountabilitySharedHabit, and git's auto-merge kept one side and
// discarded the other. Nothing in lint or the test suite resolves a
// cross-module export, so the only thing that caught it was the bundler --
// "FocusSessionHabitLink is not exported by src/api/entities.js".
export const FocusSessionHabitLink = createEntity('focus_session_habit_links');

export const ChallengeNotification = {
  ...createEntity('challenge_notifications'),

  // Replaces base44.entities.ChallengeNotification.subscribe() (Social.jsx).
  // Returns an unsubscribe function, matching the Base44 SDK's contract.
  subscribe(callback) {
    const channel = supabase
      .channel('challenge_notifications_inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'challenge_notifications' },
        (payload) => callback({ type: 'create', data: mapRow(payload.new), id: payload.new.id })
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};

// Same shape as ChallengeNotification -- see 20260915090003_freeze_assist.sql.
export const FreezeAssistNotification = {
  ...createEntity('freeze_assist_notifications'),

  subscribe(callback) {
    const channel = supabase
      .channel('freeze_assist_notifications_inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'freeze_assist_notifications' },
        (payload) => callback({ type: 'create', data: mapRow(payload.new), id: payload.new.id })
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};

// Nudges are a fire-and-forget toast, not a persistent dismissable banner
// like the notification tables above -- only .subscribe() is needed here,
// no queryable list surface.
export const AccountabilityNudge = {
  ...createEntity('accountability_nudges'),

  subscribe(callback) {
    const channel = supabase
      .channel('accountability_nudges_inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'accountability_nudges' },
        (payload) => callback({ type: 'create', data: mapRow(payload.new), id: payload.new.id })
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};

// Same shape as ChallengeNotification -- see 20260814090001_focus_session_notifications.sql.
export const FocusSessionNotification = {
  ...createEntity('focus_session_notifications'),

  subscribe(callback) {
    const channel = supabase
      .channel('focus_session_notifications_inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'focus_session_notifications' },
        (payload) => callback({ type: 'create', data: mapRow(payload.new), id: payload.new.id })
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
