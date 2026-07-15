import React, { useState, useEffect, useRef, useCallback } from "react";
import { FocusSession } from "@/api/entities";
import { differenceInSeconds, parseISO } from "date-fns";
import { Copy, Check, X, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

function pad(n) { return String(Math.floor(n)).padStart(2, "0"); }

function formatCountdown(totalSecs) {
  if (totalSecs <= 0) return "0:00";
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${pad(s)}`;
}

export default function SessionRoom({ session: initialSession, userEmail, userName, onClose }) {
  const [session, setSession] = useState(initialSession);
  const [secsLeft, setSecsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const isHost = session.host_email === userEmail;
  const warnedRef = useRef(false);
  const completedRef = useRef(false);

  // Poll session every 15 seconds for participant updates
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
        new Notification("Strk Focus", { body: `${name} joined your focus session!` });
      }
    }
    prevCountRef.current = current;
  }, [session.participant_emails]);

  // Countdown tick
  useEffect(() => {
    const tick = () => {
      const ends = parseISO(session.ends_at);
      const secs = Math.max(0, differenceInSeconds(ends, new Date()));
      setSecsLeft(secs);

      // 1-minute warning
      if (secs <= 60 && secs > 55 && !warnedRef.current) {
        warnedRef.current = true;
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Strk Focus", { body: "Focus session ending in 1 minute — finish strong! 💪" });
        }
      }

      // Completion
      if (secs === 0 && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        confetti({ particleCount: 180, spread: 100, origin: { y: 0.5 } });
        FocusSession.update(session.id, { status: "completed" });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.ends_at]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(session.session_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = () => {
    const text = `Join my focus session on Strk! Code: ${session.session_code} — ${window.location.origin}?focus=${session.session_code}`;
    if (navigator.share) navigator.share({ title: "Strk Focus", text });
    else navigator.clipboard.writeText(text);
  };

  const handleEnd = async () => {
    await FocusSession.update(session.id, { status: "completed" });
    onClose();
  };

  const participants = session.participant_emails || [];

  if (completed) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-8 text-center">
        <div className="text-7xl mb-4">🎉</div>
        <h1 className="text-3xl font-extrabold text-foreground mb-2">Session Complete!</h1>
        <p className="text-muted-foreground mb-1">{session.duration_minutes} minutes of deep focus</p>
        <p className="text-muted-foreground mb-8">{participants.length} participant{participants.length !== 1 ? "s" : ""}</p>
        <div className="flex gap-3 w-full max-w-xs">
          <Button
            className="flex-1 rounded-xl h-11"
            onClick={() => { setCompleted(false); completedRef.current = false; warnedRef.current = false; onClose(); }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-bold text-sm">Focus Session</p>
          <p className="text-xs text-muted-foreground">{session.duration_minutes} min · {session.status}</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        {/* Countdown */}
        <div className="text-center">
          <div className={cn(
            "text-8xl font-black tabular-nums tracking-tight transition-colors",
            secsLeft <= 60 ? "text-destructive" : "text-foreground"
          )}>
            {formatCountdown(secsLeft)}
          </div>
          <p className="text-sm text-muted-foreground mt-2">remaining</p>
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

        {/* Participants */}
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
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-background animate-pulse" />
                  </div>
                  <span className="text-[11px] text-muted-foreground max-w-[56px] truncate text-center">{name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* End button (host only) */}
      {isHost && (
        <div className="px-6 pb-6" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
          <Button variant="outline" className="w-full rounded-xl h-11 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleEnd}>
            End Session Early
          </Button>
        </div>
      )}
    </div>
  );
}