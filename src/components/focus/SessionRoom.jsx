import React, { useState, useEffect, useRef, useCallback } from "react";
import { FocusSession, Reaction } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { differenceInSeconds, differenceInMinutes, parseISO, format } from "date-fns";
import { Copy, Check, ChevronDown, Share2, TimerOff, WifiOff, Flame } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, prefersReducedMotion } from "@/lib/utils";
import confetti from "canvas-confetti";
import { showNotification } from "@/lib/showNotification";
import { toast } from "sonner";
import { motion } from "framer-motion";
import LobbyRing from "./LobbyRing";
import ReactionButton from "@/components/groups/ReactionButton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/useSubscription";

// How long this session's lobby runs, in seconds, measured from the row
// itself rather than from a copy of StartFocusModal's LOBBY_MINUTES. The
// ring needs a total to divide by, and a second hardcoded 2 would be a
// drift source the moment that constant ever changes -- created_at and
// lobby_ends_at are both already on the row and their difference IS the
// lobby length. Falls back to two minutes only if created_at is somehow
// missing, so the ring degrades to approximately right rather than to
// NaN.
function lobbyTotalSeconds(session) {
  if (!session.created_at || !session.lobby_ends_at) return 120;
  const total = differenceInSeconds(parseISO(session.lobby_ends_at), parseISO(session.created_at));
  return total > 0 ? total : 120;
}

// Mirrors ReactionButton's own DAILY_LIMIT and send_reaction's server-side
// check. Only used to show how many are left; the limit itself is enforced
// in the RPC, never here.
const FREE_DAILY_REACTIONS = 3;

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

// The full-screen room, as a real modal dialog.
//
// It used to be a plain `fixed inset-0` div, which meant: no role, no
// accessible name, no focus trap, no Escape, and -- because Dashboard
// renders it as a sibling rather than a portal -- the whole Dashboard
// stayed in the tab order behind it, so a keyboard user tabbed through
// invisible "New habit" and habit-card controls while a full-screen
// overlay was up. Radix in modal mode gives all of that: portal, focus
// trap and restore, Escape, scroll lock, and aria-hidden on everything
// outside.
//
// Composed from the primitives rather than the project's styled
// DialogContent, which is a centred max-w-lg card with its own close
// button and enter/exit animations -- overriding all of that to be
// full-screen would mean fighting it and shipping two close buttons.
function RoomDialog({ onMinimise, labelledBy, children }) {
  return (
    <Dialog open modal onOpenChange={(next) => { if (!next) onMinimise(); }}>
      <DialogPortal>
        <DialogPrimitive.Content
          aria-labelledby={labelledBy}
          className="fixed inset-0 z-[60] bg-background flex flex-col focus:outline-none"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// One copy control for both the lobby's prominent code pill and the
// active session's quiet inline row -- the two treatments differ in
// surrounding type and weight, not in what the button is, so it stays one
// implementation rather than two that can drift apart on the label or the
// 44px target.
function CopyCodeButton({ code, copied, onCopy }) {
  return (
    <>
      <button
        onClick={onCopy}
        className="h-11 w-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Copy session code ${code}`}
      >
        {copied ? <Check className="w-4 h-4 text-primary" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Session code copied" : ""}</span>
    </>
  );
}

// Up to five initials, then a count. The cluster sits inside LobbyRing, so
// it has a fixed budget: it caps rather than growing, and the ring never
// has to scale with headcount. There is no participant cap in the schema,
// so this needs a real answer and not an assumption that groups stay small.
const CLUSTER_CAP = 5;

// displayNameFor keeps "who am I" consistent everywhere this feature names
// people. userName was passed in from all three call sites and never read --
// so the room showed the viewer their own email prefix while the rest of the
// app showed their chosen display name. Using it is the honest way to retire
// a dead prop: it was threaded through for exactly this and nothing used it.
function displayNameFor(email, userEmail, userName) {
  if (email === userEmail && userName) return userName;
  return email.split("@")[0];
}

function AvatarCluster({ participants, userEmail, userName }) {
  const shown = participants.slice(0, CLUSTER_CAP);
  const overflow = participants.length - shown.length;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {shown.map((email) => (
        <div
          key={email}
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0",
            email === userEmail
              ? "bg-primary text-primary-foreground"
              : "bg-primary/20 text-primary"
          )}
          // The name is carried by the roster line under the ring; two
          // announcements of the same list is one too many.
          aria-hidden="true"
        >
          {displayNameFor(email, userEmail, userName).charAt(0).toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="w-12 h-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-bold shrink-0"
          aria-hidden="true"
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// Who is in the lobby, in words, because a cluster of initials cannot say
// it. Short on purpose: it sits under a 240px ring on a 320px screen.
function describeRoster(participants, userEmail) {
  const others = participants.filter((email) => email !== userEmail).map((email) => email.split("@")[0]);
  if (others.length === 0) return "No one else yet";
  if (others.length === 1) return `You and ${others[0]}`;
  if (others.length === 2) return `You, ${others[0]} and ${others[1]}`;
  return `You and ${others.length} others`;
}

function ParticipantList({ participants }) {
  return (
    <div className="w-full max-w-xs">
      {/* "Joined", not "Participants". This list is built from
          participant_emails, which only ever grows: nobody is removed on
          leaving until they explicitly leave, and there is no heartbeat
          column anywhere in the schema. So the honest claim is that these
          people joined, not that they are present.
          aria-live on the count rather than a separate "someone joined"
          region: the count already changes when the roster does, so this
          announces a join without inventing a second thing to say or
          competing with the timer region below. */}
      <p
        className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 text-center"
        aria-live="polite"
      >
        Joined ({participants.length})
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        {participants.map((email) => {
          const initials = email.split("@")[0].charAt(0).toUpperCase();
          const name = email.split("@")[0];
          return (
            // The pulsing green presence dot that used to sit on each
            // avatar is gone, along with the `relative` wrapper that
            // positioned it. It claimed live presence the data cannot
            // support -- derived purely from membership, so a friend who
            // joined and walked away kept pulsing green for 25 minutes.
            // On a surface whose selling point is who is here with you, a
            // fabricated presence indicator is worse than none, and real
            // presence would need a heartbeat we deliberately are not
            // adding.
            <div key={email} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">
                {initials}
              </div>
              <span className="text-[11px] text-muted-foreground max-w-[56px] truncate text-center">{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SessionRoom({ session: initialSession, userEmail, userName, onClose, onStartAnother }) {
  const [session, setSession] = useState(initialSession);
  const [secsLeft, setSecsLeft] = useState(0);
  const [lobbySecsLeft, setLobbySecsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  // Two-step inline confirms rather than modals, matching GroupDashboard's
  // member-removal pattern. "end" needs one because it stops three other
  // people's focus blocks and cannot be undone; "leave" needs one because
  // rejoining mid-session costs you the time already elapsed.
  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  // Consecutive poll failures, not a boolean: one miss is a blip and
  // saying "Reconnecting…" for it would cry wolf every time a packet
  // drops. Two in a row (30s of no contact) is a real problem worth
  // telling someone about.
  const [pollFailures, setPollFailures] = useState(0);
  const [starting, setStarting] = useState(false);
  // What the attached habit did when this session finished: null while
  // unresolved, then "completed" | "already" | "none". Three distinct
  // outcomes the screen has to be able to tell apart, which is why the RPC
  // returns the day it wrote rather than a boolean.
  const [habitOutcome, setHabitOutcome] = useState(null);
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
    // Was an un-caught await inside setInterval: a rejection was an
    // unhandled promise rejection every 15 seconds, and the room looked
    // completely healthy while its participant list quietly froze. On a
    // surface whose job is telling you who is here with you, silently
    // showing stale presence is the worst available failure. The room now
    // says it has lost touch.
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const sessions = await FocusSession.filter({ session_code: session.session_code });
        if (sessions[0]) setSession(sessions[0]);
        setPollFailures(0);
      } catch (err) {
        console.error("Focus session poll failed:", err);
        setPollFailures((n) => n + 1);
      }
    };
    const poll = setInterval(refresh, 15000);

    // The interval skips while the tab is hidden, which is right -- but it
    // meant returning to the tab could show up to 15s of stale roster, or
    // a stale 'waiting' status, and the lobby is only 2 minutes long. One
    // immediate refresh on becoming visible closes that window.
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
    // Only the host's deliberate "Start Now" gets a pending state. The
    // automatic call at the end of the lobby fires from every client's
    // 1s tick and must stay invisible -- showing "Starting…" on a button
    // nobody pressed would be noise.
    if (force) setStarting(true);
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
      // Reported only for the host's explicit press. The automatic path
      // self-heals -- the 1s tick keeps re-calling while secs is 0 and
      // advancingRef resets in `finally` -- so surfacing its transient
      // failures would alarm people about something already recovering.
      if (force) setActionError("Couldn't start the session. Check your connection and try again.");
    } finally {
      advancingRef.current = false;
      if (force) setStarting(false);
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
        // 180 particles is the biggest burst in the app, and it is
        // exactly what somebody who asked their OS for reduced motion is
        // asking not to be shown. The screen still celebrates -- the hero,
        // the Flame entrance and the copy carry it -- so skipping this
        // costs the moment nothing it needed.
        if (!prefersReducedMotion()) {
          confetti({ particleCount: 180, spread: 100, origin: { y: 0.5 } });
        }
        // complete_focus_session, not FocusSession.update: under
        // focus_sessions_update this write matched zero rows for every
        // non-host, and entities.js's update() ends in .select().single(),
        // which throws on zero rows -- so every non-host finishing a session
        // fired a guaranteed-to-fail write and an unhandled rejection. The
        // screen rendered anyway (local state), which is why it went
        // unnoticed. Worse, if the host's tab was shut when the timer
        // elapsed, nobody could write the status at all and the row stayed
        // 'active'. The RPC authorises on `now() >= ends_at`, so any
        // participant can ratify an ending the clock already decided.
        // Still fire-and-forget: the user's completion screen must not wait
        // on a bookkeeping write, but the failure is no longer silent.
        supabase.rpc("complete_focus_session", { p_session_id: session.id })
          .then(({ error }) => { if (error) console.error("Failed to mark session completed:", error); })
          .catch((err) => console.error("Failed to mark session completed:", err));

        // Credit the attached habit, if there is one. Each client completes
        // its OWN habit -- the RPC resolves it by auth.uid() and takes no
        // habit argument, so nobody can write anyone else's. Fire-and-forget
        // for the same reason as the status write: the celebration must not
        // wait on bookkeeping. The local date is the client's own calendar
        // day, matching how Dashboard stamps a manual completion.
        if (session.habit_name) {
          supabase.rpc("complete_habit_from_focus_session", {
            p_session_id: session.id,
            p_local_date: format(new Date(), "yyyy-MM-dd"),
          }).then(({ data, error }) => {
            if (error) {
              console.error("Failed to credit habit from focus session:", error);
              setHabitOutcome("failed");
              return;
            }
            // The RPC now returns the outcome itself, so there is nothing
            // to infer. It used to return a nullable date, and this line
            // read `data ? "completed" : "already"` -- which told anyone
            // who does not track the host's habit that it "was already
            // done today". An unknown value falls through to the neutral
            // pending copy rather than asserting anything.
            setHabitOutcome(data || "unknown");
          }).catch((err) => {
            console.error("Failed to credit habit from focus session:", err);
            setHabitOutcome("failed");
          });
        }
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.status, session.ends_at]);

  // Both of these used to assume success. handleCopyCode set copied=true
  // unconditionally and never caught, so where the clipboard is
  // unavailable or rejects -- no permission, non-secure context -- the
  // user got a green checkmark over an empty clipboard. The confirmation
  // now follows the write rather than racing it.
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(session.session_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy session code:", err);
      toast.error("Couldn't copy the code. Long-press it to copy instead.");
    }
  };

  // handleInvite's fallback branch copied with no feedback whatsoever, so
  // on any browser without Web Share the Invite button appeared to do
  // nothing at all. And navigator.share rejects with AbortError when the
  // user simply dismisses the sheet, which was landing as an unhandled
  // rejection on the ordinary cancel path.
  const handleInvite = async () => {
    const text = `Join my focus session on Strk! Code: ${session.session_code}. ${window.location.origin}?focus=${session.session_code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Strk Focus", text });
      } catch (err) {
        // Dismissing the share sheet is a decision, not a failure.
        if (err?.name !== "AbortError") {
          console.error("Failed to share focus session:", err);
          toast.error("Couldn't open the share sheet. The code is on screen to send manually.");
        }
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Invite copied — send it to whoever you want in the session.");
    } catch (err) {
      console.error("Failed to copy focus invite:", err);
      toast.error("Couldn't copy the invite. The code is on screen to send manually.");
    }
  };

  // Host only, and guarded by the inline confirm in the footer. Writes
  // status for everyone, which each other client turns into the "Session
  // Ended Early" screen. Errors now surface instead of leaving an inert
  // tap: previously this awaited with no catch, so a failed write meant
  // onClose() never ran and the button appeared to do nothing.
  const handleEndForEveryone = async () => {
    setActionBusy(true);
    setActionError("");
    try {
      await FocusSession.update(session.id, { status: "completed" });
      onClose();
    } catch (err) {
      console.error("Failed to end focus session:", err);
      setActionError("Couldn't end the session. Check your connection and try again.");
    } finally {
      setActionBusy(false);
    }
  };

  // Non-host only. Closing the room was never leaving it: onClose() drops
  // the room but leaves the caller in participant_emails, so
  // FocusSessionBanner immediately offers "tap to return" and a session
  // joined by mistake could not be escaped. This removes them for real, via
  // an RPC because focus_sessions_update is host-only.
  const handleLeave = async () => {
    setActionBusy(true);
    setActionError("");
    try {
      const { error } = await supabase.rpc("leave_focus_session", { p_session_id: session.id });
      if (error) throw error;
      onClose();
    } catch (err) {
      console.error("Failed to leave focus session:", err);
      setActionError("Couldn't leave the session. Check your connection and try again.");
    } finally {
      setActionBusy(false);
    }
  };

  const { isPro } = useSubscription();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Same query key and client-side day filter GroupDashboard already uses
  // for this, so the two share one cache entry instead of each fetching
  // the sender's reactions independently.
  const { data: reactionsSentData = [] } = useQuery({
    queryKey: ["reactions-sent", userEmail, todayStr],
    queryFn: () => userEmail ? Reaction.filter({ sender_email: userEmail }, "-created_date") : [],
    enabled: !!userEmail,
  });
  const reactionsSentToday = reactionsSentData.filter(
    (r) => r.created_date?.slice(0, 10) === todayStr
  ).length;

  // send_reaction derives sender identity itself and enforces the daily
  // limit and the both-parties check server-side -- see
  // 20261021090002 for the focus-session authorisation path this uses.
  const sendReactionMutation = useMutation({
    mutationFn: ({ recipient_email, emoji, focus_session_id }) =>
      supabase.rpc("send_reaction", {
        p_recipient_email: recipient_email,
        p_emoji: emoji,
        p_group_id: null,
        p_focus_session_id: focus_session_id,
      }).then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["reactions-sent", userEmail] });
      queryClient.invalidateQueries({ queryKey: ["reactions", userEmail] });
      toast.success(`Reaction sent! ${vars.emoji}`, { duration: 2000 });
    },
    onError: (err) => {
      // The RPC raises this exact keyword so the client can show the
      // upgrade path rather than a generic failure.
      if (err?.message?.includes("DAILY_LIMIT_REACHED")) {
        toast.error("That's today's 3 reactions. Pro removes the cap.");
        return;
      }
      console.error("Failed to send reaction:", err);
      toast.error("Couldn't send that reaction. Check your connection and try again.");
    },
  });

  const participants = session.participant_emails || [];
  const isAlone = participants.length <= 1;
  const reactionsRemaining = Math.max(0, FREE_DAILY_REACTIONS - reactionsSentToday);

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
    const reduceMotion = prefersReducedMotion();
    const hostName = session.host_name || session.host_email?.split("@")[0] || "The host";
    const dismiss = () => {
      setFinishedNaturally(false);
      completedRef.current = false;
      warnedRef.current = false;
      onClose();
    };

    return (
      // Dismiss, not onClose, for the Escape/overlay path too: this screen
      // has to reset the completion refs or reopening the room from the
      // Dashboard banner would land straight back on it.
      <RoomDialog onMinimise={dismiss} labelledBy="focus-session-outcome">
        <div className="flex-1 overflow-y-auto px-5 py-8 flex flex-col justify-center">
          <div className="w-full max-w-sm mx-auto space-y-4">
            {/* Built on ChallengeCompleteScreen's hero, which is this app's
                precedent for ending a shared thing well: a framed gradient,
                the brand Flame, and the people named. The old screen was an
                emoji, two grey lines and "Done" -- it named nobody, which on
                the product's core social feature is the peak-end moment
                thrown away.
                Two deliberate departures from that precedent: no eyebrow
                above the heading (the heading carries its own weight), and
                the facts run as one line rather than framed stat tiles,
                which is the hero-metric template this screen doesn't need. */}
            <div className={cn(
              "rounded-2xl border p-6 text-center space-y-3",
              endedEarly
                ? "bg-muted/40 border-border"
                : "bg-gradient-to-br from-primary/20 via-accent/15 to-primary/10 border-primary/30"
            )}>
              {endedEarly ? (
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto" aria-hidden="true">
                  <TimerOff className="w-7 h-7 text-muted-foreground" />
                </div>
              ) : (
                // A one-shot entrance, matching ChallengeCompleteScreen's
                // single authored moment.
                //
                // Correcting a claim an earlier pass left in this file:
                // Framer Motion does NOT honour prefers-reduced-motion on
                // its own -- its reducedMotion option defaults to "never"
                // and has to be opted into via MotionConfig, which this
                // project does not set up. So the preference is applied
                // here explicitly, by starting from the resting state
                // instead of animating into it.
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.6, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 18 }}
                  className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto"
                  aria-hidden="true"
                >
                  <Flame className="w-7 h-7 text-primary" />
                </motion.div>
              )}

              {/* role="status" so the swap is announced rather than
                  silently replacing the screen. DialogTitle renders the h2
                  that names the dialog, so the outcome is both the heading
                  and the accessible name. */}
              <div role="status">
                <DialogTitle id="focus-session-outcome" className="text-2xl font-extrabold text-foreground">
                  {endedEarly ? "Session Ended Early" : "Session Complete"}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-1">
                  {endedEarly ? (
                    <>
                      {hostName} ended it for everyone
                      {minutesIn !== null && minutesIn > 0 && ` after ${minutesIn} of ${session.duration_minutes} minutes`}.
                    </>
                  ) : (
                    `${session.duration_minutes} minutes · ${participants.length === 1 ? "on your own" : `${participants.length} of you`}`
                  )}
                </DialogDescription>
              </div>

              {/* What the attached habit actually did. Four outcomes, said
                  plainly: an early end credits nothing because the session
                  did not happen, a network failure says so rather than
                  claiming the habit is untracked, and "already done today"
                  is distinguished from "you track no habit by that name"
                  because the RPC returns the outcome itself
                  (20261025090001). It previously returned a nullable date
                  and null meant four different things, so this comment
                  described an intention the code did not implement: every
                  participant without the host's habit was told it was
                  already done today. */}
              {session.habit_name && (
                <div className="pt-1">
                  {endedEarly ? (
                    <p className="text-xs text-muted-foreground">
                      {session.habit_name} wasn&apos;t credited — the session didn&apos;t finish.
                    </p>
                  ) : habitOutcome === "completed" ? (
                    <p className="text-xs font-medium text-primary flex items-center justify-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {session.habit_name} marked done for today
                    </p>
                  ) : habitOutcome === "already_done" ? (
                    <p className="text-xs text-muted-foreground">
                      {session.habit_name} was already done today.
                    </p>
                  ) : habitOutcome === "no_habit" ? (
                    // The branch that was missing, and the reason the bug
                    // existed. The host attaches THEIR habit; joining a
                    // session does not give you one.
                    <p className="text-xs text-muted-foreground">
                      You don&apos;t track {session.habit_name}, so nothing was credited.
                    </p>
                  ) : habitOutcome === "archived" ? (
                    <p className="text-xs text-muted-foreground">
                      {session.habit_name} is archived, so nothing was credited.
                    </p>
                  ) : habitOutcome === "failed" ? (
                    <p className="text-xs text-muted-foreground">
                      Couldn&apos;t update {session.habit_name}. Mark it on your Habits screen.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Counting toward {session.habit_name}…</p>
                  )}
                </div>
              )}
            </div>

            {/* The people, named. This is the whole point of the rebuild:
                the roster is what makes the session a shared thing rather
                than a timer that happened to be running. Shown for an early
                end too -- they did sit together, whatever cut it short. */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {participants.length === 1 ? "Just you" : "You focused with"}
              </p>
              <ul className="space-y-2">
                {participants.map((email) => (
                  <li key={email} className="flex items-center gap-3">
                    <div className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0",
                      email === userEmail ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"
                    )} aria-hidden="true">
                      {displayNameFor(email, userEmail, userName).charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium truncate flex-1 min-w-0">
                      {displayNameFor(email, userEmail, userName)}
                      {email === userEmail && <span className="text-xs text-muted-foreground font-normal ml-1">(you)</span>}
                    </span>
                    {/* The reaction mechanic PRODUCT.md calls core, at the
                        moment it is most earned. Not on your own row, and
                        only where there is somebody else to thank. */}
                    {email !== userEmail && (
                      <ReactionButton
                        recipientEmail={email}
                        groupId={null}
                        focusSessionId={session.id}
                        sentTodayCount={reactionsSentToday}
                        isPro={isPro}
                        onSend={(data) => sendReactionMutation.mutateAsync(data)}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {/* Free users get three reactions a day, enforced server-side.
                  Showing what is left means a free user in a four-person
                  session sees the wall coming instead of hitting it
                  partway down the roster. */}
              {!isPro && participants.length > 1 && (
                <p className="text-xs text-muted-foreground mt-3">
                  {reactionsRemaining > 0
                    ? `${reactionsRemaining} of 3 reactions left today`
                    : "You've used today's 3 reactions — Pro removes the cap."}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              {/* "Start another" only where the caller can actually open
                  the start flow, and only after a real finish -- offering
                  it under a session somebody just cut short reads as
                  tone-deaf. */}
              {onStartAnother && !endedEarly ? (
                <>
                  <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={dismiss}>
                    Done
                  </Button>
                  <Button
                    className="flex-1 rounded-xl h-11 font-semibold"
                    onClick={() => { dismiss(); onStartAnother(); }}
                  >
                    Start another
                  </Button>
                </>
              ) : (
                <Button className="flex-1 rounded-xl h-11" onClick={dismiss}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      </RoomDialog>
    );
  }

  const inLobby = session.status === "waiting";

  // Minute granularity, deliberately. The countdown itself re-renders every
  // second, and a live region tracking it would make a screen reader read a
  // number 1,500 times per session, drowning out everything else on the
  // screen. This changes once a minute, so it announces once a minute -- and
  // the last minute is called out by name rather than as "1".
  const liveStatus = inLobby
    ? (lobbySecsLeft > 60
        ? `Starting in ${Math.ceil(lobbySecsLeft / 60)} minutes`
        : "Starting in less than a minute")
    : secsLeft <= 60
      ? "Final minute of the session"
      : `${Math.ceil(secsLeft / 60)} minutes remaining`;

  return (
    <RoomDialog onMinimise={onClose} labelledBy="focus-session-heading">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <DialogTitle id="focus-session-heading" className="font-bold text-sm">Focus Session</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {session.duration_minutes} min · {inLobby ? "starting soon" : session.status}
          </DialogDescription>
          {/* Two consecutive misses, so a single dropped request stays
              quiet. Announced as well as shown: a frozen roster is
              invisible either way, so the only honest signal is saying
              so. */}
          {pollFailures >= 2 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5" role="status">
              <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" />
              Reconnecting… who&apos;s here may be out of date
            </p>
          )}
        </div>
        {/* Was an X labelled "Close focus session", which is what it looks
            like and not what it does: the session keeps running and the
            Dashboard banner offers to take you straight back. A chevron and
            an honest label, since leaving for real is now its own footer
            action. h-11 w-11 rather than size="icon"'s 36px -- this is the
            top-right corner of a one-handed screen. */}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={onClose}
          aria-label="Minimise — the session keeps running"
          title="Minimise — the session keeps running"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-8 px-6 py-6">
        {/* The lobby and the running session want opposite hierarchies.
            The lobby's one question is "is anyone coming?", so the people
            are the hero and the time is the ring around them. Once the
            timer is running the time is the only thing that matters and
            it takes the stage back. */}
        {inLobby ? (
          <LobbyRing fractionRemaining={lobbySecsLeft / lobbyTotalSeconds(session)}>
            <AvatarCluster participants={participants} userEmail={userEmail} userName={userName} />
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground" aria-hidden="true">
                {formatCountdown(lobbySecsLeft)}
              </p>
              <p className="text-xs text-muted-foreground">until the timer begins</p>
            </div>
          </LobbyRing>
        ) : (
          <div className="text-center">
            {/* aria-hidden on the visible digits, with the live region
                below carrying the same information at a rate a screen
                reader can actually use. Without this a per-second DOM
                change sits directly in the accessibility tree. */}
            <div
              className={cn(
                // text-7xl below sm, not 8xl: "60:00" is five font-black
                // glyphs, and at 96px that is roughly 258px against the
                // 272px a 320px viewport leaves after px-6 -- fitting with
                // nothing to spare. The house pattern steps type for the
                // same reason (Dashboard's text-2xl sm:text-3xl).
                "text-7xl sm:text-8xl font-black tabular-nums tracking-tight transition-colors",
                secsLeft <= 60 ? "text-destructive" : "text-foreground"
              )}
              aria-hidden="true"
            >
              {formatCountdown(secsLeft)}
            </div>
            <p className="text-sm text-muted-foreground mt-2">remaining</p>
          </div>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">{liveStatus}</p>

        {/* Lobby: the code is the second most important thing on screen,
            because the lobby exists to get people in. Active: joining
            late is a confirmation-gated edge case, so the code stops
            holding centre-screen for the next 25 to 60 minutes and the
            people you are sitting with take that place instead.
            Demoted, not removed -- you can still pull someone in. */}
        {inLobby ? (
          <>
            {/* The roster in words, since a cluster of initials can't say
                who is there. aria-live because this is now the line that
                changes when somebody joins -- the lobby no longer renders
                ParticipantList, which used to carry that announcement. */}
            <p className="text-sm font-medium text-foreground text-center" aria-live="polite">
              {describeRoster(participants, userEmail)}
            </p>
            <div className="flex flex-col items-center gap-2 w-full max-w-xs">
              {/* Alone in the lobby, Invite is the only action that can
                  change anything, so it stops being a quiet outline button
                  below the code and becomes the primary one. This is the
                  state the old layout failed hardest: it answered "is
                  anyone coming?" with a roster of yourself. */}
              {isAlone ? (
                <>
                  <Button className="w-full rounded-xl h-11 gap-2 font-semibold" onClick={handleInvite}>
                    <Share2 className="w-4 h-4" /> Invite someone
                  </Button>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span className="text-xs uppercase tracking-wide">or share code</span>
                    <span className="font-mono text-sm tracking-widest text-foreground ml-1">{session.session_code}</span>
                    <CopyCodeButton code={session.session_code} copied={copied} onCopy={handleCopyCode} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 bg-muted rounded-2xl px-5 py-3">
                    <span className="font-mono font-black text-2xl tracking-widest text-foreground">{session.session_code}</span>
                    <CopyCodeButton code={session.session_code} copied={copied} onCopy={handleCopyCode} />
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={handleInvite}>
                    <Share2 className="w-3.5 h-3.5" /> Invite
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <ParticipantList participants={participants} />
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="text-xs uppercase tracking-wide">Code</span>
              <span className="font-mono text-sm tracking-widest text-foreground ml-1">{session.session_code}</span>
              <CopyCodeButton code={session.session_code} copied={copied} onCopy={handleCopyCode} />
              <Button variant="ghost" size="sm" className="gap-1.5 rounded-xl h-11" onClick={handleInvite}>
                <Share2 className="w-3.5 h-3.5" /> Invite
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-6 pb-6 space-y-2" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
        {inLobby && isHost && (
          <Button
            className="w-full rounded-xl h-11 font-semibold"
            onClick={() => { setActionError(""); advanceToActive(true); }}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start Now"}
          </Button>
        )}

        {actionError && (
          <p className="text-xs text-destructive-text text-center" role="alert">{actionError}</p>
        )}

        {/* The footer used to render for the host alone, so a non-host had
            no control of any kind -- their only interactive exit was the
            top-right icon, which did not actually leave. */}
        {pendingAction === "end" ? (
          <>
            {/* Names the blast radius. "End Session Early" never disclosed
                that it ends the session for everyone, and it was one
                unguarded tap. */}
            <p className="text-xs text-muted-foreground text-center">
              End this session for all {participants.length} of you? This can't be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={() => setPendingAction(null)} disabled={actionBusy}>
                Keep going
              </Button>
              <Button
                className="flex-1 rounded-xl h-11 font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleEndForEveryone}
                disabled={actionBusy}
              >
                {actionBusy ? "Ending…" : "End for everyone"}
              </Button>
            </div>
          </>
        ) : pendingAction === "leave" ? (
          <>
            <p className="text-xs text-muted-foreground text-center">
              Leave this session? The others keep going, and rejoining later starts you with whatever time is left.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={() => setPendingAction(null)} disabled={actionBusy}>
                Stay
              </Button>
              <Button className="flex-1 rounded-xl h-11 font-semibold" onClick={handleLeave} disabled={actionBusy}>
                {actionBusy ? "Leaving…" : "Leave"}
              </Button>
            </div>
          </>
        ) : !inLobby && isHost ? (
          <Button
            variant="outline"
            className="w-full rounded-xl h-11 text-destructive-text border-destructive/30 hover:bg-destructive/5"
            onClick={() => { setActionError(""); setPendingAction("end"); }}
          >
            End for everyone
          </Button>
        ) : !isHost ? (
          <Button
            variant="outline"
            className="w-full rounded-xl h-11"
            onClick={() => { setActionError(""); setPendingAction("leave"); }}
          >
            Leave session
          </Button>
        ) : null}
      </div>
    </RoomDialog>
  );
}
