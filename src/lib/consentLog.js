/**
 * Server-side evidence for the analytics consent decision
 * (20261026090006).
 *
 * Deliberately separate from analyticsConsent.js, which stays
 * dependency-free: that module is imported by AnalyticsConsentBanner,
 * which App.jsx mounts OUTSIDE the auth gate, and it is the enforcement
 * gate. This module is the evidence record and needs Supabase, so keeping
 * them apart preserves the property that the gate works with no network
 * and no session — the same reasoning partnerNotice.js is split out for.
 */
import { supabase } from "@/api/supabaseClient";

/**
 * The version of PRIVACY_POLICY.md a consent decision is recorded against.
 *
 * Must match the document's "Last updated" line. src/lib/consentLog.test.js
 * parses that line and fails if these drift, because a stale constant
 * silently records consent against the wrong document — worse than no log.
 * The brief called keeping these in sync "required human discipline"; the
 * test is there so it is not left to discipline.
 */
export const PRIVACY_POLICY_VERSION = "2026-10-26";

/** "granted" | "denied" | null — the caller's most recently logged decision. */
export async function latestLoggedConsent() {
  const { data, error } = await supabase
    .from("analytics_consent_log")
    .select("decision")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.decision ?? null;
}

/**
 * Append a consent decision. Never updates — the table has no update or
 * delete policy, so the history is the record.
 */
export async function logAnalyticsConsent(decision) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("analytics_consent_log").insert({
    user_id: user.id,
    decision,
    policy_version: PRIVACY_POLICY_VERSION,
  });
  if (error) throw error;
}

/**
 * Bring the server record in line with the local decision, once per login.
 *
 * Idempotent on purpose. The decision lives in localStorage and is made
 * before there is a session, so without a comparison this would append a
 * row on every app open and turn the log into noise. A row is written only
 * when the local decision differs from the most recently logged one, or
 * when nothing has been logged yet.
 *
 * An undecided visitor writes nothing: there is no decision to evidence,
 * and the banner is still asking.
 *
 * Returns true when a row was written, so callers can tell "reconciled"
 * from "already in sync" without guessing.
 */
export async function reconcileConsentLog(localDecision) {
  if (localDecision !== "granted" && localDecision !== "denied") return false;

  const latest = await latestLoggedConsent();
  if (latest === localDecision) return false;

  await logAnalyticsConsent(localDecision);
  return true;
}
