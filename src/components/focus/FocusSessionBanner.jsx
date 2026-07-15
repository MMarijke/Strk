import React, { useState, useEffect } from "react";
import { FocusSession } from "@/api/entities";
import { differenceInMinutes, parseISO } from "date-fns";

export default function FocusSessionBanner({ userEmail, onOpen }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!userEmail) return;
    const check = async () => {
      if (document.hidden) return;
      const sessions = await FocusSession.filter({ status: "active" });
      const mine = sessions.find((s) =>
        (s.participant_emails || []).includes(userEmail) &&
        new Date(s.ends_at) > new Date()
      );
      setSession(mine || null);
    };
    check();
    const t = setInterval(check, 180000);
    return () => clearInterval(t);
  }, [userEmail]);

  if (!session) return null;

  const minsLeft = Math.max(0, differenceInMinutes(parseISO(session.ends_at), new Date()));

  return (
    <button
      onClick={() => onOpen(session)}
      className="w-full mb-4 rounded-xl bg-primary/10 border border-primary/20 px-4 py-3 flex items-center gap-3 text-left hover:bg-primary/15 transition-colors"
    >
      <span className="text-xl">🎯</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Focus session active</p>
        <p className="text-xs text-muted-foreground">{minsLeft} min{minsLeft !== 1 ? "s" : ""} left · tap to return</p>
      </div>
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
    </button>
  );
}