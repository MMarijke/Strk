import { useEffect, useRef } from "react";
import { getAnalyticsConsent } from "@/lib/analyticsConsent";
import { reconcileConsentLog } from "@/lib/consentLog";

/**
 * Brings the server consent record in line with the local decision, once
 * per session.
 *
 * This exists because the decision and the evidence are made in different
 * places. AnalyticsConsentBanner is mounted outside the auth gate in
 * App.jsx — deliberately, since PostHog initialises on the public landing
 * page and that pre-login capture is exactly what consent gates — so at
 * the moment somebody chooses, there is no user to key a row to. The
 * choice goes to localStorage, which stays the enforcement gate; this
 * records it server-side the first time they are signed in afterwards.
 *
 * Mounted from AppLayout beside FocusInviteListener and
 * AccountabilityNudgeListener, which is where this app puts things that
 * need to run once wherever the user happens to be. Renders nothing.
 *
 * reconcileConsentLog is idempotent — it appends only when the local
 * decision differs from the most recently logged one — so the ref here is
 * belt and braces against remounts, not the thing preventing duplicate
 * rows.
 */
export default function ConsentLogReconciler({ userEmail }) {
  const ran = useRef(false);

  useEffect(() => {
    if (!userEmail || ran.current) return;
    ran.current = true;

    // An undecided visitor writes nothing: the banner is still asking, and
    // there is no decision to evidence yet.
    const local = getAnalyticsConsent();
    if (!local) return;

    reconcileConsentLog(local).catch((err) => {
      // Fire-and-forget with the rejection handled. A failure means the
      // row is written on the next open instead, since the comparison runs
      // again — and it must never block or degrade the session, because
      // the gate is already in force from localStorage.
      console.error("Failed to reconcile analytics consent log:", err);
    });
  }, [userEmail]);

  return null;
}
