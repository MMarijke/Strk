import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BADGES } from "./badgeDefinitions";

/**
 * The badge-id whitelist is duplicated: once in BADGES here, once in
 * award_badge's `if p_badge_id not in (...)` guard.
 *
 * That duplication is deliberate — there is no badges table to be the
 * single source, and inventing one for twelve static strings would be
 * worse than the duplication. But it drifts silently: adding a badge to
 * BADGES alone means the client shows it, computes eligibility for it, and
 * then award_badge rejects it at runtime with "Unknown badge id: ...".
 * Nothing in lint, typecheck or the build can see across that boundary.
 *
 * So this test is the guard. It reads the whitelist back out of the
 * NEWEST migration that defines award_badge, rather than a hardcoded
 * filename, so a future redefinition is picked up automatically.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** The most recent migration that (re)defines award_badge. */
function newestAwardBadgeMigration() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    // Timestamp-prefixed filenames, so a lexical sort is chronological.
    .sort();

  for (let i = files.length - 1; i >= 0; i--) {
    const full = path.join(MIGRATIONS_DIR, files[i]);
    const sql = fs.readFileSync(full, "utf8");
    if (sql.includes("create or replace function public.award_badge(")) {
      return { file: files[i], sql };
    }
  }
  return null;
}

/** The ids inside award_badge's `not in ( ... )` guard. */
function serverBadgeIds(sql) {
  const m = /if p_badge_id not in \(([^)]*)\)/.exec(sql);
  if (!m) return null;
  return [...new Set(m[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)))].sort();
}

describe("badge id whitelist", () => {
  const found = newestAwardBadgeMigration();

  it("finds a migration defining award_badge", () => {
    expect(found).not.toBeNull();
  });

  it("finds the whitelist inside it", () => {
    expect(serverBadgeIds(found.sql)).not.toBeNull();
  });

  // The actual point of the file.
  it("matches the ids the client defines in BADGES", () => {
    const server = serverBadgeIds(found.sql);
    const client = [...new Set(BADGES.map((b) => b.id))].sort();

    // Reported as set differences rather than a bare equality failure, so
    // the message says which id was added where.
    const missingOnServer = client.filter((id) => !server.includes(id));
    const missingOnClient = server.filter((id) => !client.includes(id));

    expect(
      { missingOnServer, missingOnClient },
      `award_badge (${found.file}) and BADGES disagree. A badge only in BADGES is shown, ` +
      "evaluated, and then rejected at runtime with \"Unknown badge id\"."
    ).toEqual({ missingOnServer: [], missingOnClient: [] });
  });

  it("has no duplicate ids on either side", () => {
    const client = BADGES.map((b) => b.id);
    expect(client).toHaveLength(new Set(client).size);
  });
});
