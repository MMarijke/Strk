import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRIVACY_POLICY_VERSION is what every consent row is stamped with, and it
 * is a hand-maintained copy of a date that lives in a Markdown document.
 * The brief called keeping those in sync "required human discipline" — this
 * is that discipline, enforced.
 *
 * A stale constant does not fail loudly. It records consent against a
 * policy the user never saw, which is worse than having no log, because
 * the log then asserts something untrue.
 *
 * The constant is read out of the source rather than imported: consentLog.js
 * imports supabaseClient, which calls createClient at module scope and
 * throws "supabaseUrl is required" without env vars. Same reason
 * partnerNotice.js was split out from accountabilityService.js.
 */

const ROOT = process.cwd();

function policyLastUpdated() {
  const md = fs.readFileSync(path.join(ROOT, "PRIVACY_POLICY.md"), "utf8");
  const m = /\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(md);
  return m ? m[1] : null;
}

function constantInSource() {
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "consentLog.js"), "utf8");
  const m = /PRIVACY_POLICY_VERSION\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(src);
  return m ? m[1] : null;
}

describe("PRIVACY_POLICY_VERSION", () => {
  it("is parseable out of PRIVACY_POLICY.md", () => {
    expect(policyLastUpdated()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is parseable out of consentLog.js", () => {
    expect(constantInSource()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The point of the file.
  it("matches the policy document's Last updated date", () => {
    expect(
      constantInSource(),
      "PRIVACY_POLICY_VERSION has drifted from PRIVACY_POLICY.md's \"Last updated\" line. " +
      "Every consent row is stamped with this constant, so a stale value records consent " +
      "against a policy version the user never saw. Update the constant whenever the " +
      "document changes."
    ).toBe(policyLastUpdated());
  });
});
