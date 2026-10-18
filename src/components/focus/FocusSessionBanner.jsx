import React, { useState, useEffect } from "react";
import { FocusSession } from "@/api/entities";
import { differenceInMinutes, parseISO } from "date-fns";
import NotificationBanner from "@/components/dashboard/NotificationBanner";

export default function FocusSessionBanner({ userEmail, onOpen, onActiveChange }) {
  const [session, setSession] = useState(null);

  // Separate from the polling effect below on purpose -- this only reports
  // the boolean TodayTray needs, and shouldn't be entangled with that
  // effect's own interval-cadence dependency logic.
  useEffect(() => {
    onActiveChange?.(!!session);
  }, [!!session, onActiveChange]);

  useEffect(() => {
    if (!userEmail) return;
    const check = async () => {
      if (document.hidden) return;
      // Include 'waiting' so a lobby session is just as recoverable as an
      // active one -- otherwise anyone who navigates away during the
      // 2-minute lobby gets no way back in until it goes active.
      const sessions = await FocusSession.filter({ '$or': [{ status: "active" }, { status: "waiting" }] });
      const mine = sessions.find((s) => {
        if (!(s.participant_emails || []).includes(userEmail)) return false;
        return s.status === "waiting"
          ? new Date(s.lobby_ends_at) > new Date()
          : new Date(s.ends_at) > new Date();
      });
      setSession(mine || null);
    };
    check();
    // Fast cadence only while a lobby is actually in flight for this user --
    // that's the sole window where staleness can mean missing the entire
    // waiting -> active transition inside its 2-minute duration (matches
    // SessionRoom.jsx's own poll interval for the same data). Every other
    // Dashboard visit has no session at all, so stay at the slow baseline
    // rather than multiplying every user's background polling for a feature
    // most aren't using at any given moment.
    const intervalMs = session?.status === "waiting" ? 15000 : 180000;
    const t = setInterval(check, intervalMs);
    return () => clearInterval(t);
  }, [userEmail, session?.status]);

  if (!session) return null;

  const inLobby = session.status === "waiting";
  const minsLeft = Math.max(0, differenceInMinutes(
    parseISO(inLobby ? session.lobby_ends_at : session.ends_at),
    new Date()
  ));

  return (
    <NotificationBanner
      onClick={() => onOpen(session)}
      icon={<span className="text-base leading-none">🎯</span>}
      title={inLobby ? "Focus session starting soon" : "Focus session active"}
      subtitle={
        inLobby
          ? `starts in ${minsLeft < 1 ? "under a minute" : `${minsLeft} min${minsLeft !== 1 ? "s" : ""}`} · tap to return`
          : `${minsLeft} min${minsLeft !== 1 ? "s" : ""} left · tap to return`
      }
      indicator={<span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" aria-hidden="true" />}
    />
  );
}