import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FocusSessionNotification } from "@/api/entities";
import { joinFocusSession } from "@/lib/focusSessionJoin";
import JoinInProgressConfirm from "./JoinInProgressConfirm";

// The toast's own content, so the join -> maybe-confirm -> maybe-ended
// sequence has real React state (and a real loading indicator) instead of
// closures re-issuing toast() calls for each step. sonner keeps whatever
// node you pass mounted, so internal state transitions just re-render in
// place -- duration is Infinity (see below) precisely so this multi-step
// decision can't get cut off mid-flow by an auto-expiry timer.
function FocusInviteToastBody({ notif, onJoined, onStale, onCancel }) {
  const [view, setView] = useState("join");
  const [loading, setLoading] = useState(false);
  const stillInLobby = notif.lobby_ends_at && new Date(notif.lobby_ends_at) > new Date();

  const attemptJoin = async (confirmActive) => {
    setLoading(true);
    const result = await joinFocusSession(notif.session_code, confirmActive);
    setLoading(false);
    if (result.ok) {
      onJoined(result.session);
      return;
    }
    if (result.reason === "IN_PROGRESS") {
      setView("confirm");
      return;
    }
    setView("ended");
    onStale();
  };

  if (view === "ended") {
    return <p className="text-sm text-muted-foreground py-1">This focus session has already ended.</p>;
  }

  if (view === "confirm") {
    return <JoinInProgressConfirm onCancel={onCancel} onConfirm={() => attemptJoin(true)} loading={loading} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎯</span>
        <div>
          <p className="font-semibold text-sm text-foreground leading-tight">
            {notif.host_name || "Someone"} started a focus session!
          </p>
          <p className="text-xs text-muted-foreground">
            {notif.duration_minutes} min · {notif.group_name}
            {stillInLobby ? " · join before it starts!" : " · may already be underway"}
          </p>
        </div>
      </div>
      <button
        className="w-full rounded-lg bg-primary text-primary-foreground text-xs font-semibold py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-60"
        onClick={() => attemptJoin(false)}
        disabled={loading}
      >
        {loading ? "Joining…" : "Join →"}
      </button>
    </div>
  );
}

// Global counterpart to FocusSessionInviteBanner (TodayTray, Dashboard-only):
// mounted once app-wide from AppLayout.jsx so a group member sitting on
// Trends/Social/Settings when a host starts a session still gets notified,
// not just whoever happens to already be on Dashboard.
export default function FocusInviteListener({ userEmail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shownNotifIds = useRef(new Set());

  useEffect(() => {
    if (!userEmail) return;
    const unsubscribe = FocusSessionNotification.subscribe((event) => {
      if (event.type !== "create") return;
      const notif = event.data;
      if (notif.recipient_email !== userEmail) return;
      if (shownNotifIds.current.has(event.id)) return;
      shownNotifIds.current.add(event.id);

      const dismissInDb = () => {
        FocusSessionNotification.update(notif.id, { dismissed: true }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["focus-session-notifications", userEmail] });
        });
      };

      toast(
        <FocusInviteToastBody
          notif={notif}
          onJoined={(session) => {
            dismissInDb();
            toast.dismiss(notif.id);
            // Only Dashboard.jsx renders SessionRoom for the host path today
            // -- there's no global "active session" state to piggyback on
            // from an arbitrary page, so route there and hand the joined
            // session off via router state.
            navigate("/Dashboard", { replace: true, state: { joinFocusSession: session } });
          }}
          onStale={dismissInDb}
          onCancel={() => toast.dismiss(notif.id)}
        />,
        // Infinity: this can be a multi-step decision (join -> confirm
        // active -> maybe ended); an auto-expiry could cut that off
        // mid-flow. Still swipeable (dismissible), and cleared
        // programmatically once resolved.
        { id: notif.id, duration: Infinity, dismissible: true }
      );
    });
    return unsubscribe;
  }, [userEmail, navigate, queryClient]);

  return null;
}
