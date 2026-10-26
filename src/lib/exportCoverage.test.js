import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * export-my-data must cover every table in the schema.
 *
 * Its whole purpose is to answer "everything you hold about me" truthfully.
 * A table missing from EXPORT_SPEC is not a visible bug -- the export still
 * succeeds, still looks complete, and still reports a row_count. It just
 * quietly omits a category of the user's data, which turns the document
 * into a false statement about what we hold.
 *
 * That failure cannot be caught by reading the function, because the
 * omission is the absence of a line. So this compares the spec against the
 * migrations, which are the only authoritative list of tables, and fails
 * when a new `create table` lands without a decision about exporting it.
 *
 * Adding a table means either listing it in EXPORT_SPEC with its ownership
 * predicate, or in SPECIAL_CASE_TABLES if it is matched some other way
 * (paddle_events, which has no user column at all). Both are deliberate;
 * silence is not.
 *
 * Source is parsed rather than imported: the function is Deno TypeScript
 * with https:// imports and a module-scope requireEnv() that throws
 * without secrets, so it cannot be loaded into vitest. Same approach as
 * badgeIds.test.js and consentLog.test.js.
 */

const ROOT = process.cwd();
const FN = path.join(ROOT, "supabase", "functions", "export-my-data", "index.ts");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

function tablesInMigrations() {
  const names = new Set();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    const re = /create table\s+(?:if not exists\s+)?(?:public\.)?(\w+)/gi;
    let m;
    while ((m = re.exec(sql)) !== null) names.add(m[1]);
  }
  return names;
}

function source() {
  return fs.readFileSync(FN, "utf8");
}

/** The table keys of the EXPORT_SPEC object literal. */
function specTables() {
  const src = source();
  const start = src.indexOf("const EXPORT_SPEC");
  expect(start, "EXPORT_SPEC not found in export-my-data/index.ts").toBeGreaterThan(-1);
  // Up to the closing `};` of the object literal.
  const end = src.indexOf("\n};", start);
  const body = src.slice(start, end);
  const names = new Set();
  // `table_name: (u) => [...]` at the start of a line, two spaces in.
  const re = /^ {2}(\w+):\s*\(/gm;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

function specialCaseTables() {
  const m = /const SPECIAL_CASE_TABLES\s*=\s*\[([^\]]*)\]/.exec(source());
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1]));
}

describe("export-my-data coverage", () => {
  it("parses a plausible set of tables out of the migrations", () => {
    const tables = tablesInMigrations();
    // Guards the regex itself: if this parsed nothing, every other
    // assertion below would pass vacuously.
    expect(tables.size).toBeGreaterThan(10);
    expect(tables).toContain("habits");
    expect(tables).toContain("user_profiles");
  });

  it("parses the spec out of the function source", () => {
    expect(specTables().size).toBeGreaterThan(10);
    expect(specialCaseTables()).toContain("paddle_events");
  });

  // The point of the file.
  it("covers every table in the schema", () => {
    const schema = tablesInMigrations();
    const covered = new Set([...specTables(), ...specialCaseTables()]);
    const missing = [...schema].filter((t) => !covered.has(t)).sort();

    expect(
      missing,
      "These tables exist in supabase/migrations but are absent from " +
      "export-my-data. The export would still succeed and still look " +
      "complete while omitting them, so a user's data export would be a " +
      "false statement about what we hold. Add each to EXPORT_SPEC with " +
      "its ownership predicate, or to SPECIAL_CASE_TABLES if it is matched " +
      "another way."
    ).toEqual([]);
  });

  it("does not claim to export tables that no longer exist", () => {
    const schema = tablesInMigrations();
    const stale = [...specTables(), ...specialCaseTables()]
      .filter((t) => !schema.has(t))
      .sort();

    expect(
      stale,
      "export-my-data references tables that no migration creates. Either " +
      "the table was dropped and the spec entry is dead, or the name is " +
      "misspelled -- in which case that table is silently missing from " +
      "every export."
    ).toEqual([]);
  });
});
