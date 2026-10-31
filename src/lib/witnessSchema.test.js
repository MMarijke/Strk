import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Schema invariants for the witnessed tier system.
 *
 * Two of these are security properties, not style preferences.
 * rolling_best_streak_90 and witness_slots decide tier and leaderboard
 * standing, so if either is missing from protect_user_profiles_stats_fields
 * a plain `supabase.from("user_profiles").update({ witness_slots: {...all
 * true} })` tops every leaderboard — the exact hole 20260914090004 was
 * written to close for best_streak. Nothing in CI executes this SQL
 * (per-PR Supabase preview branches are disabled on this project), so a
 * source-level assertion is the only check that exists.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

/** Body of the newest migration that redefines `fn`. */
function newestDefinition(fn) {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let found = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const re = new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\n\\$\\$;`);
    const m = re.exec(sql);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

const NEW_COLUMNS = ["rolling_best_streak_90", "witness_slots"];

describe("the stat-column guard covers the new tier inputs", () => {
  it("finds the guard", () => {
    const g = newestDefinition("protect_user_profiles_stats_fields");
    expect(g, "no migration defines protect_user_profiles_stats_fields").not.toBeNull();
    expect(g.body).toContain("best_streak");
  });

  it("guards both new columns", () => {
    const { body } = newestDefinition("protect_user_profiles_stats_fields");
    const missing = NEW_COLUMNS.filter(
      (c) => !body.includes(`new.${c} is distinct from old.${c}`)
    );
    expect(
      missing,
      "These columns decide tier and leaderboard standing but are not in " +
      "the lockdown guard, so any authenticated user can write them " +
      "directly and top every leaderboard."
    ).toEqual([]);
  });

  it("compares with IS DISTINCT FROM, never != or <>", () => {
    // auth.role() is NULL on any connection with no JWT context, and
    // `!= NULL` is NULL, which is falsy in an IF — silently allowing the
    // update. The guard has to fail closed.
    const { body } = newestDefinition("protect_user_profiles_stats_fields");
    const guardIf = body.slice(body.indexOf("if ("), body.indexOf("then"));
    expect(guardIf).not.toMatch(/!=|<>/);
    expect(guardIf).toContain("auth.role() is distinct from 'service_role'");
  });

  it("keeps every column the previous version already guarded", () => {
    // A redefinition that drops a column silently reopens that hole.
    const { body } = newestDefinition("protect_user_profiles_stats_fields");
    for (const col of [
      "best_streak",
      "consistency_score",
      "total_completions",
      "last_completion_date",
      "last_week_completion_rate",
      "prev_week_completion_rate",
      "last_week_top_habit_name",
      "last_week_top_habit_count",
    ]) {
      expect(
        body.includes(`new.${col} is distinct from old.${col}`),
        `${col} was guarded before this redefinition and no longer is`
      ).toBe(true);
    }
  });
});

describe("the guard trigger stays SECURITY INVOKER", () => {
  it("does not declare security definer", () => {
    // The trap documented in CLAUDE.md and 20260727090001: a DEFINER
    // trigger resets current_user to its OWN owner the moment it starts,
    // so the `current_user is distinct from 'profile_stats_sync_trusted'`
    // check would fail permanently — including for the legitimate write it
    // is meant to allow.
    const { body } = newestDefinition("protect_user_profiles_stats_fields");
    const head = body.slice(0, body.indexOf("as $$"));
    expect(head).not.toMatch(/security\s+definer/i);
  });
});

describe("recompute_witness_slots", () => {
  it("is SECURITY DEFINER and owned by the trusted role", () => {
    const f = newestDefinition("recompute_witness_slots");
    expect(f, "no migration defines recompute_witness_slots").not.toBeNull();
    expect(f.body.slice(0, f.body.indexOf("as $$"))).toMatch(/security\s+definer/i);

    const sql = fs.readFileSync(path.join(MIGRATIONS, f.file), "utf8");
    expect(
      /alter function public\.recompute_witness_slots\(uuid, text\)\s*\n?\s*owner to profile_stats_sync_trusted/.test(sql),
      "Without this owner the function's UPDATE fails the lockdown guard, " +
      "which only lets profile_stats_sync_trusted or service_role through."
    ).toBe(true);
  });

  it("covers all five witness slots", () => {
    const { body } = newestDefinition("recompute_witness_slots");
    for (const slot of ["reacted", "session", "challenge", "assist", "partner"]) {
      expect(body, `slot '${slot}' missing`).toContain(`'${slot}',`);
    }
  });

  it("reads each slot from the table it claims to", () => {
    const { body } = newestDefinition("recompute_witness_slots");
    for (const table of [
      "public.reactions",
      "public.focus_sessions",
      "public.group_challenges",
      "public.freeze_assists",
      "public.accountability_partnerships",
    ]) {
      expect(body, `${table} not read`).toContain(table);
    }
  });

  it("grants the owning role SELECT on every table it reads", () => {
    // The role is noinherit nologin with narrow grants. A missing grant
    // here is a runtime permission error inside a function whose own
    // `exception when others` would swallow it into a warning.
    const f = newestDefinition("recompute_witness_slots");
    const sql = fs.readFileSync(path.join(MIGRATIONS, f.file), "utf8");
    const missing = [
      "reactions",
      "focus_sessions",
      "group_challenges",
      "freeze_assists",
      "accountability_partnerships",
      "user_profiles",
    ].filter((t) => !sql.includes(`grant select on public.${t} to profile_stats_sync_trusted`));
    expect(missing, "tables read without a SELECT grant for the owning role").toEqual([]);
  });
});

describe("the backfill does not use SET ROLE", () => {
  it("takes the service_role claim hatch instead", () => {
    // 20261025090002 recorded CI catching the alternative: `set local role
    // profile_stats_sync_trusted` leaves RLS in force with auth.uid() NULL
    // because that role has no BYPASSRLS, so the UPDATE matches zero rows
    // and succeeds silently — a no-op behind a green tick.
    const f = newestDefinition("recompute_witness_slots");
    const sql = fs.readFileSync(path.join(MIGRATIONS, f.file), "utf8");
    // Comments stripped first: this migration's header explains at length
    // why SET ROLE is wrong here, and matching the explanation instead of
    // the code is how an earlier version of this assertion failed.
    const code = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/set\s+local\s+role/i);
    expect(code).toContain(`set_config('request.jwt.claims', '{"role": "service_role"}', true)`);
  });
});

describe("sync_profile_stats_from_habits keeps what earlier fixes added", () => {
  it("still writes every stat column, plus the new rolling form", () => {
    const { body } = newestDefinition("sync_profile_stats_from_habits");
    for (const col of [
      "best_streak",
      "rolling_best_streak_90",
      "consistency_score",
      "total_completions",
      "last_completion_date",
    ]) {
      expect(body, `${col} no longer written`).toContain(`${col} =`);
    }
  });

  it("still filters archived habits out of consistency only", () => {
    // 20261025090002's rule: historical counts every habit, a
    // forward-looking rate counts only tracked ones.
    const { body } = newestDefinition("sync_profile_stats_from_habits");
    expect(body).toContain("where not archived");
  });

  it("still guards every date cast against a malformed entry", () => {
    // 20260915090001: one unparseable element makes the whole array
    // uncastable, on every call thereafter.
    const { body } = newestDefinition("sync_profile_stats_from_habits");
    const GUARD = "d ~ '^\\d{4}-\\d{2}-\\d{2}$'";
    const unnests = [...body.matchAll(/unnest\(oh\.completions\) as d/g)];
    expect(unnests.length).toBeGreaterThan(0);
    const unguarded = unnests.filter(
      (m) => !body.slice(m.index, m.index + 200).includes(GUARD)
    );
    expect(unguarded.map((m) => m.index), "unguarded date cast").toEqual([]);
  });

  it("refreshes witness in the same transaction", () => {
    const { body } = newestDefinition("sync_profile_stats_from_habits");
    expect(body).toContain("recompute_witness_slots(new.created_by_id, new.created_by)");
  });
});
