// Returns everything the database holds about the caller, as one JSON
// document. This is the GDPR/POPIA right of access and data portability
// (CLAUDE.md: "GDPR/POPIA applies (Seedstack-wide requirement)"), the
// counterpart to delete-account -- we could erase a user's data on request
// but never show it to them.
//
// ============================================================
// Why service_role rather than the caller's own JWT
// ============================================================
//
// Running these reads through the caller's client would be the safer
// instinct, and it is wrong here for two reasons:
//
//   1. paddle_events has RLS enabled and NO select policy at all, so the
//      caller reads zero rows from it -- yet it holds their billing
//      history, which is unambiguously personal data about them. An export
//      that silently omitted it would assert completeness it does not have.
//   2. RLS is scoped to what a user may SEE, not what is ABOUT them.
//      user_profiles_select permits every `is_public = true` row, so a
//      caller-scoped `select *` would rake in every peer's profile and
//      present other people's data as the caller's own.
//
// So this runs as service_role with an explicit filter per table. That
// moves the burden onto those filters, so they are declared as data in
// EXPORT_SPEC below rather than scattered through the code, and every one
// of them keys off `user.id` or `user.email` as resolved from the verified
// JWT. Nothing in the request body is ever used to decide whose data to
// return -- there is no request body.
//
// ============================================================
// Rows where the caller is the counterparty
// ============================================================
//
// A received nudge carries the sender's email; a group the caller merely
// belongs to carries every other member's email in member_emails. These
// rows are included as stored.
//
// Art. 15(4) says access must not adversely affect the rights of others,
// which is why that deserves a reason rather than a shrug: every one of
// these rows is already visible to the caller in the app itself -- they
// received the nudge and can see who sent it, they are in the group and can
// see the member list. The export therefore discloses nothing they could
// not already read, and redacting the counterparty would misrepresent what
// the record actually says. Omitting them instead would leave the user's
// own partnership and group history out of their own history.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { initSentry, captureException } from "../_shared/sentry.ts";
import { requireEnv } from "../_shared/env.ts";
import { checkRateLimit, createRateLimiter } from "../_shared/rate-limit.ts";

initSentry("export-my-data");

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// Generous but bounded. An export is ~20 queries against service_role, so
// it is the most expensive thing an authenticated user can ask for, and
// without a cap it is an amplifier. Five an hour leaves room for retries
// and failed downloads while making it useless for hammering -- a real
// access request needs one.
const rateLimiter = createRateLimiter("export-my-data", 5, "1 h");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type Ident = { id: string; email: string };

// One simple predicate. Deliberately NOT a PostgREST `or=(...)` string:
// several of these match an email inside a text[] column, and building
// that filter by string concatenation puts a user-controlled value into
// PostgREST's own filter grammar. Separate queries unioned by primary key
// cost a few more round trips and cannot be malformed by an unusual
// address.
type Predicate = { col: string; op: "eq" | "contains"; val: string };

const eq = (col: string, val: string): Predicate => ({ col, op: "eq", val });
const has = (col: string, val: string): Predicate => ({ col, op: "contains", val });

// Every table in the schema, and how each one links to a person.
//
// Keep this exhaustive. A table missing from here is silently absent from
// every export, which is the failure mode this feature exists to prevent,
// so src/lib/exportCoverage.test.js asserts this covers every `create table`
// in supabase/migrations.
const EXPORT_SPEC: Record<string, (u: Ident) => Predicate[]> = {
  // Owned outright, by uuid.
  profiles: (u) => [eq("id", u.id)],
  user_profiles: (u) => [eq("created_by_id", u.id)],
  habits: (u) => [eq("created_by_id", u.id)],
  streak_freezes: (u) => [eq("created_by_id", u.id)],
  user_badges: (u) => [eq("created_by_id", u.id)],
  analytics_consent_log: (u) => [eq("user_id", u.id)],
  accountability_shared_habits: (u) => [eq("owner_id", u.id)],
  challenge_habit_links: (u) => [eq("user_id", u.id)],
  focus_session_habit_links: (u) => [eq("user_id", u.id)],

  // Created by the caller, or containing them in a text[] member list.
  groups: (u) => [eq("created_by_id", u.id), has("member_emails", u.email)],
  group_challenges: (u) => [eq("created_by_id", u.id), has("member_emails", u.email)],
  focus_sessions: (u) => [eq("created_by_id", u.id), has("participant_emails", u.email)],

  // Two-sided: the caller may be either end.
  accountability_partnerships: (u) => [eq("requester_email", u.email), eq("partner_email", u.email)],
  accountability_nudges: (u) => [eq("sender_email", u.email), eq("recipient_email", u.email)],
  freeze_assists: (u) => [eq("assister_email", u.email), eq("target_email", u.email)],
  reactions: (u) => [
    eq("created_by_id", u.id),
    eq("sender_email", u.email),
    eq("recipient_email", u.email),
  ],
  freeze_assist_notifications: (u) => [
    eq("created_by_id", u.id),
    eq("assister_email", u.email),
    eq("recipient_email", u.email),
  ],
  challenge_notifications: (u) => [
    eq("created_by_id", u.id),
    eq("recipient_email", u.email),
    eq("started_by_email", u.email),
  ],
  focus_session_notifications: (u) => [
    eq("created_by_id", u.id),
    eq("host_email", u.email),
    eq("recipient_email", u.email),
  ],

  // paddle_events is handled separately -- it has no column identifying a
  // user at all, only the raw webhook payload. See collectPaddleEvents.
};

// Tables whose rows carry no user column and must be matched through the
// payload instead. Listed so the coverage test can tell "handled
// elsewhere" from "forgotten".
const SPECIAL_CASE_TABLES = ["paddle_events"];

type Row = Record<string, unknown>;

/**
 * Run each predicate as its own query and union the results by primary key.
 *
 * A row matching two predicates (a group the caller both created and is
 * listed in) would otherwise appear twice in their export and read as
 * duplicated data.
 */
async function collectTable(
  admin: ReturnType<typeof createClient>,
  table: string,
  predicates: Predicate[],
): Promise<Row[]> {
  const byId = new Map<string, Row>();
  for (const p of predicates) {
    const query = admin.from(table).select("*");
    const { data, error } = p.op === "eq"
      ? await query.eq(p.col, p.val)
      : await query.contains(p.col, [p.val]);
    if (error) throw new Error(`${table}.${p.col}: ${error.message}`);
    for (const row of data ?? []) {
      // Every table in this schema has a uuid primary key named id. Fall
      // back to a stable serialisation rather than dropping a row if that
      // ever stops being true.
      const key = typeof row.id === "string" ? row.id : JSON.stringify(row);
      byId.set(key, row);
    }
  }
  return [...byId.values()];
}

/**
 * The caller's billing events, matched through the stored webhook payload.
 *
 * paddle_events exists for webhook idempotency, not for per-user queries:
 * it has event_id, event_type, payload and timestamps, and nothing naming
 * a user. The only link is the Paddle ids on the caller's own profile, so
 * with no subscription there is nothing to match and the result is
 * legitimately empty -- which is different from "we did not look".
 *
 * payload is the whole event object as received (see paddle-webhook's
 * insert), so the ids live at payload.data.*.
 */
async function collectPaddleEvents(
  admin: ReturnType<typeof createClient>,
  customerId: string | null,
  subscriptionId: string | null,
): Promise<Row[]> {
  const byId = new Map<string, Row>();

  // subscription events carry the subscription as data.id; transaction
  // events reference it as data.subscription_id. Both are the caller's.
  const lookups: Array<[string, string]> = [];
  if (customerId) lookups.push(["payload->data->>customer_id", customerId]);
  if (subscriptionId) {
    lookups.push(["payload->data->>id", subscriptionId]);
    lookups.push(["payload->data->>subscription_id", subscriptionId]);
  }

  for (const [path, val] of lookups) {
    const { data, error } = await admin.from("paddle_events").select("*").eq(path, val);
    if (error) throw new Error(`paddle_events.${path}: ${error.message}`);
    for (const row of data ?? []) {
      const key = typeof row.id === "string" ? row.id : JSON.stringify(row);
      byId.set(key, row);
    }
  }
  return [...byId.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Resolve who the caller actually is from their own JWT. There is no
  // request body by design: nothing a client sends can influence whose
  // data comes back.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user?.id || !user.email) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const rateLimitResponse = await checkRateLimit(rateLimiter, user.id, CORS_HEADERS);
  if (rateLimitResponse) return rateLimitResponse;

  const ident: Ident = { id: user.id, email: user.email };
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const tables: Record<string, Row[]> = {};

    for (const [table, predicatesFor] of Object.entries(EXPORT_SPEC)) {
      tables[table] = await collectTable(admin, table, predicatesFor(ident));
    }

    // Read the Paddle ids off the profile we just exported rather than
    // querying for them again.
    const profileRow = tables.user_profiles?.[0] ?? null;
    tables.paddle_events = await collectPaddleEvents(
      admin,
      (profileRow?.paddle_customer_id as string | undefined) ?? null,
      (profileRow?.paddle_subscription_id as string | undefined) ?? null,
    );

    const rowCount = Object.values(tables).reduce((n, rows) => n + rows.length, 0);

    return jsonResponse({
      // Stated in the document itself so the file is self-describing once
      // it has been downloaded and separated from this app.
      export_format_version: 1,
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email },
      notes: [
        "This file contains every row the Strk database holds that identifies you, including rows owned by other people that name you (a group you joined, a nudge you were sent).",
        "Rows are exported exactly as stored, so a shared record also shows the other person involved. You can already see all of this in the app.",
        "An empty table means there is nothing of yours in it.",
        "paddle_events holds raw billing webhooks from Paddle and is empty unless you have had a subscription.",
      ],
      table_count: Object.keys(tables).length,
      row_count: rowCount,
      tables,
    });
  } catch (err) {
    // Fail the whole export rather than returning a partial one. A
    // document that looks complete but silently dropped a table is worse
    // than an error the user can retry, because they would have no way to
    // know what was missing.
    console.error("export-my-data: failed", user.id, err);
    await captureException(err, { userId: user.id });
    return jsonResponse({ error: "Couldn't build your export. Please try again." }, 500);
  }
});
