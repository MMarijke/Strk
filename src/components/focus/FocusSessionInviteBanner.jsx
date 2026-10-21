import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FocusSessionNotification } from "@/api/entities";
import { Target } from "lucide-react";
import NotificationBanner from "@/components/dashboard/NotificationBanner";
import { joinFocusSession, describeJoinFailure, isJoinFailurePermanent } from "@/lib/focusSessionJoin";
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
  const [error, setError] = useState("");

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
    setError("");
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
    // Only a genuine NOT_FOUND means the invite is spent. This used to
    // treat every failure as "already ended" and dismiss the notification
    // row with it -- so one tap on bad wifi permanently discarded a
    // still-valid invite. A transport failure now leaves the row alone
    // and stays retryable.
    if (isJoinFailurePermanent(result.reason)) {
      setView("ended");
      dismissMutation.mutate(notif.id);
      return;
    }
    setError(describeJoinFailure(result.reason));
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
          error={error}
        />
      </div>
    );
  }

  return (
    <NotificationBanner
      onClick={() => !loading && attemptJoin(false)}
      icon={<Target className="w-4 h-4 text-primary" />}
      title={`${notif.host_name || "Someone"} started a focus session`}
      subtitle={
        loading
          ? "Joining…"
          // A failed join reports itself here and the banner stays tappable,
          // rather than the row being dismissed as though the session had
          // ended. NotificationBanner has no dedicated error slot, so the
          // subtitle carries it.
          : error
            ? `${error} Tap to retry.`
            : `${notif.duration_minutes} min · ${notif.group_name} · ${stillInLobby ? "Tap to join" : "Tap to join (in progress)"}`
      }
      onDismiss={() => dismissMutation.mutate(notif.id)}
    />
  );
}
