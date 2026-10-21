import React, { useState, useEffect, useRef, useCallback } from "react";
import { FocusSession } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { differenceInSeconds, differenceInMinutes, parseISO } from "date-fns";
import { Copy, Check, X, Share2, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { showNotification } from "@/lib/showNotification";

function pad(n) { return String(Math.floor(n)).padStart(2, "0"); }

function formatCountdown(totalSecs) {
  if (totalSecs <= 0) return "0:00";
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${pad(s)}`;
}

// Whole minutes between the session actually starting and now, capped at its
// own duration and never negative. Used to tell a participant how far a
// session got before someone ended it. Null when it never started, which is
// why the copy that uses it is conditional rather than printing "0".
function elapsedMinutes(session) {
  if (!session.started_at) return null;
  const mins = differenceInMinutes(new Date(), parseISO(session.started_at));
  return Math.max(0, Math.min(session.duration_minutes, mins));
}

function ParticipantList({ participants }) {
  return (
    <div className="w-full max-w-xs">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 text-center">
        Participants ({participants.length})
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        {participants.map((email) => {
          const initials = email.split("@")[0].charAt(0).toUpperCase();
          const name = email.split("@")[0];
          return (
            <div key={email} className="flex flex-col items-center gap-1.5">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">
                  {initials}
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-success border-2 border-background animate-pulse" />
              </div>
              <span className="text-[11px] text-muted-foreground max-w-[56px] truncate text-center">{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SessionRoom({ session: initialSession, userEmail, userName, onClose }) {
  const [session, setSession] = useState(initialSession);
  const [secsLeft, setSecsLeft] = useState(0);
  const [lobbySecsLeft, setLobbySecsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  // True once *this client's own* timer reached zero. Deliberately not the
  // same thing as the session's status being 'completed', which can also
  // mean somebody else ended it before its deadline -- see endedEarly in the
  // render below. The two are different events and get different screens:
  // one is a celebration, the other is news.
  const [finishedNaturally, setFinishedNaturally] = useState(false);
  const isHost = session.host_email === userEmail;
  const warnedRef = useRef(false);
  const completedRef = useRef(false);
  const advancingRef = useRef(false);

  // Poll session every 15 seconds for participant updates (and, during the
  // lobby, to pick up the active-transition if another client's tab is the
  // one driving it).
  useEffect(() => {
    const poll = setInterval(async () => {
      if (document.hidden) return;
      const sessions = await FocusSession.filter({ session_code: session.session_code });
      if (sessions[0]) setSession(sessions[0]);
    }, 15000);
    return () => clearInterval(poll);
  }, [session.session_code]);

  // Notify host when participants join
  const prevCountRef = useRef(session.participant_emails?.length || 0);
  useEffect(() => {
    const current = session.participant_emails?.length || 0;
    if (current > prevCountRef.current && isHost) {
      const newEmail = session.participant_emails[session.participant_emails.length - 1];
      const name = newEmail.split("@")[0];
      if ("Notification" in window && Notification.permission === "granted") {
        showNotification("Strk Focus", {
          body: `${name} joined your focus session!`,
          data: { url: `${window.location.origin}/Dashboard` },
        });
      }
    }
    prevCountRef.current = current;
  }, [session.participant_emails]);

  // Lobby -> active transition. Runs on every participant's client (not
  // just the host's), since the host's tab may be closed/backgrounded when
  // the natural deadline passes. Race safety lives in the RPC itself
  // (UPDATE ... WHERE status = 'waiting'), not here -- this is just about
  // not firing redundant calls from a single client.
  const advanceToActive = useCallback(async (force) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      const { data, error } = await supabase.rpc("start_focus_session_now", {
        p_session_id: session.id,
        p_force: force,
      });
      if (error) throw error;
      if (data) {
        // We won the race (or were the only caller) -- data carries the
        // started_at/ends_at this call just set.
        setSession(data);
      } else {
        // WHERE status = 'waiting' matched zero rows: another client's call
        // already won. Harmless no-op -- pick up what they set instead of
        // trusting our own local clock.
        const sessions = await FocusSession.filter({ session_code: session.session_code });
        if (sessions[0]) setSession(sessions[0]);
      }
    } catch (err) {
      console.error("Failed to start focus session:", err);
    } finally {
      advancingRef.current = false;
    }
  }, [session.id, session.session_code]);

  // Lobby countdown tick
  useEffect(() => {
    if (session.status !== "waiting" || !session.lobby_ends_at) return;
    const tick = () => {
      const lobbyEnds = parseISO(session.lobby_ends_at);
      const secs = Math.max(0, differenceInSeconds(lobbyEnds, new Date()));
      setLobbySecsLeft(secs);
      if (secs === 0) advanceToActive(false);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.status, session.lobby_ends_at, advanceToActive]);

  // Focus timer countdown tick (only once active -- ends_at is unset during
  // the lobby)
  useEffect(() => {
    if (session.status !== "active" || !session.ends_at) return;
    const tick = () => {
      const ends = parseISO(session.ends_at);
      const secs = Math.max(0, differenceInSeconds(ends, new Date()));
      setSecsLeft(secs);

      // 1-minute warning
      if (secs <= 60 && secs > 55 && !warnedRef.current) {
        warnedRef.current = true;
        if ("Notification" in window && Notification.permission === "granted") {
          showNotification("Strk Focus", {
            body: "Focus session ending in 1 minute. Finish strong! 💪",
            data: { url: `${window.location.origin}/Dashboard` },
          });
        }
      }

      // Completion
      if (secs === 0 && !completedRef.current) {
        completedRef.current = true;
        setFinishedNaturally(true);
        confetti({ particleCount: 180, spread: 100, origin: { y: 0.5 } });
        FocusSession.update(session.id, { status: "completed" });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.status, session.ends_at]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(session.session_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = () => {
    const text = `Join my focus session on Strk! Code: ${session.session_code}. ${window.location.origin}?focus=${session.session_code}`;
    if (navigator.share) navigator.share({ title: "Strk Focus", text });
    else navigator.clipboard.writeText(text);
  };

  const handleEnd = async () => {
    await FocusSession.update(session.id, { status: "completed" });
    onClose();
  };

  const participants = session.participant_emails || [];

  // A session ending before its own deadline ends it for everyone, and every
  // other participant finds out only from this status change. Nothing used to
  // handle it: the active-timer effect above bails on `status !== "active"`,
  // so its interval stopped, secsLeft kept whatever value it last held, and
  // the room went on rendering a 96px countdown claiming time was still
  // running -- indefinitely, under a 12px header that by then read
  // "completed". The most prominent element on the screen was lying, in a
  // feature whose whole credibility is being right about time.
  //
  // Derived from session.status rather than tracked in its own state on
  // purpose: a state-setting effect would leave one frame where status is
  // already 'completed' and the stale countdown is still painted. This way
  // the room cannot render a number for a session that has stopped.
  const endedEarly = !finishedNaturally && session.status === "completed";

  if (finishedNaturally || endedEarly) {
    const minutesIn = endedEarly ? elapsedMinutes(session) : null;
    const hostName = session.host_name || session.host_email?.split("@")[0] || "The host";
    const dismiss = () => {
      setFinishedNaturally(false);
      completedRef.current = false;
      warnedRef.current = false;
      onClose();
    };

    return (
      <div className="fixed inset-0 z-[60] bg-background flex flex-col items-center justify-center p-8 text-center">
        {/* A real icon rather than a second emoji: this screen is the one
            place in the flow that has to read as information, not
            celebration, and 🎉's counterpart would be a frown. */}
        {endedEarly ? (
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4" aria-hidden="true">
            <TimerOff className="w-8 h-8 text-muted-foreground" />
          </div>
        ) : (
          <div className="text-7xl mb-4" aria-hidden="true">🎉</div>
        )}
        {/* role="status" so the swap is announced rather than silently
            replacing the screen. The room's wider live-region work is a
            separate pass; an explanation nobody is told about is not an
            explanation, so this much ships with the fix. */}
        <div role="status">
          <h1 className="text-3xl font-extrabold text-foreground mb-2">
            {endedEarly ? "Session Ended Early" : "Session Complete!"}
          </h1>
          {endedEarly ? (
            <p className="text-muted-foreground mb-1">
              {hostName} ended it for everyone
              {minutesIn !== null && minutesIn > 0 && ` after ${minutesIn} of ${session.duration_minutes} minutes`}.
            </p>
          ) : (
            <p className="text-muted-foreground mb-1">{session.duration_minutes} minutes of deep focus</p>
          )}
          <p className="text-muted-foreground mb-8">{participants.length} participant{participants.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-3 w-full max-w-xs">
          <Button className="flex-1 rounded-xl h-11" onClick={dismiss}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const inLobby = session.status === "waiting";

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-bold text-sm">Focus Session</p>
          <p className="text-xs text-muted-foreground">{session.duration_minutes} min · {inLobby ? "starting soon" : session.status}</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close focus session">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-8 px-6 py-6">
        {/* Countdown */}
        <div className="text-center">
          {inLobby && (
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Starting in</p>
          )}
          <div className={cn(
            "text-8xl font-black tabular-nums tracking-tight transition-colors",
            !inLobby && secsLeft <= 60 ? "text-destructive" : "text-foreground"
          )}>
            {formatCountdown(inLobby ? lobbySecsLeft : secsLeft)}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {inLobby ? "until the timer begins" : "remaining"}
          </p>
        </div>

        {/* Session code */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session Code</p>
          <div className="flex items-center gap-2 bg-muted rounded-2xl px-5 py-3">
            <span className="font-mono font-black text-2xl tracking-widest text-foreground">{session.session_code}</span>
            <button onClick={handleCopyCode} className="text-muted-foreground hover:text-foreground transition-colors">
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={handleInvite}>
            <Share2 className="w-3.5 h-3.5" /> Invite
          </Button>
        </div>

        <ParticipantList participants={participants} />
      </div>

      {/* Footer actions */}
      <div className="px-6 pb-6 space-y-2" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
        {inLobby && isHost && (
          <Button className="w-full rounded-xl h-11 font-semibold" onClick={() => advanceToActive(true)}>
            Start Now
          </Button>
        )}
        {!inLobby && isHost && (
          <Button variant="outline" className="w-full rounded-xl h-11 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleEnd}>
            End Session Early
          </Button>
        )}
      </div>
    </div>
  );
}
