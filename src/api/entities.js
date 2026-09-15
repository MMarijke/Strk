import { supabase } from '@/api/supabaseClient';

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

function createEntity(table) {
  return {
    async list(sort) {
      let query = supabase.from(table).select('*');
      query = applySort(query, sort);
      const { data, error } = await query;
      if (error) throw error;
      return data.map(mapRow);
    },

    async filter(conditions = {}, sort) {
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
      const { data: row, error } = await supabase.from(table).update(data).eq('id', id).select().single();
      if (error) throw error;
      return mapRow(row);
    },

    async delete(id) {
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
