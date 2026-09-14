import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FocusSessionNotification } from "@/api/entities";
import { Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { joinFocusSession } from "@/lib/focusSessionJoin";
import JoinInProgressConfirm from "./JoinInProgressConfirm";

// TodayTray counterpart to FocusInviteListener's global toast -- same
// underlying notification row, but a persistent, re-tappable surface
// (mirrors ChallengeStartBanner's own query/dismiss pattern). Unlike
// ChallengeStartBanner (a <Link> to a details view), tapping this joins
// directly: it's already mounted inside Dashboard.jsx (via TodayTray), so a
// successful join can just hand the session back up through onJoined
// instead of navigating anywhere -- the same convention FocusSessionBanner
// already uses via its onOpen prop.
export default function FocusSessionInviteBanner({ userEmail, onJoined, onActiveChange }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState("join");
  const [loading, setLoading] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ["focus-session-notifications", userEmail],
    queryFn: () =>
      userEmail
        ? FocusSessionNotification.filter(
            { recipient_email: userEmail, dismissed: false },
            "-created_date"
          )
        : [],
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => FocusSessionNotification.update(id, { dismissed: true }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["focus-session-notifications", userEmail] }),
  });

  useEffect(() => {
    onActiveChange?.(notifications.length > 0);
  }, [notifications.length, onActiveChange]);

  if (!notifications.length) return null;

  // Show the most recent undismissed notification
  const notif = notifications[0];
  const stillInLobby = notif.lobby_ends_at && new Date(notif.lobby_ends_at) > new Date();

  const attemptJoin = async (confirmActive) => {
    setLoading(true);
    const result = await joinFocusSession(notif.session_code, confirmActive);
    setLoading(false);
    if (result.ok) {
      dismissMutation.mutate(notif.id);
      onJoined?.(result.session);
      return;
    }
    if (result.reason === "IN_PROGRESS") {
      setView("confirm");
      return;
    }
    setView("ended");
    dismissMutation.mutate(notif.id);
  };

  if (view === "ended") {
    return (
      <div className="rounded-xl bg-muted/60 border border-border px-4 py-3 mb-4">
        <p className="text-xs text-muted-foreground">That focus session has already ended.</p>
      </div>
    );
  }

  if (view === "confirm") {
    return (
      <div className="rounded-xl bg-card border border-border px-4 py-3 mb-4">
        <JoinInProgressConfirm
          onCancel={() => setView("join")}
          onConfirm={() => attemptJoin(true)}
          loading={loading}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !loading && attemptJoin(false)}
      onKeyDown={(e) => { if (!loading && (e.key === "Enter" || e.key === " ")) attemptJoin(false); }}
      className="rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 px-4 py-3 flex items-center gap-3 mb-4 cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
        <Target className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-foreground truncate">
          {notif.host_name || "Someone"} started a focus session
        </p>
        <p className="text-[11px] text-muted-foreground">
          {loading
            ? "Joining…"
            : `${notif.duration_minutes} min · ${notif.group_name} · ${stillInLobby ? "Tap to join" : "Tap to join (in progress)"}`}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0 h-7 w-7 rounded-full hover:bg-primary/10"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dismissMutation.mutate(notif.id);
        }}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}
