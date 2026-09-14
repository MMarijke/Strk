import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChallengeNotification } from "@/api/entities";
import { Trophy, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function ChallengeStartBanner({ userEmail, onActiveChange }) {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["challenge-notifications", userEmail],
    queryFn: () =>
      userEmail
        ? ChallengeNotification.filter(
            { recipient_email: userEmail, dismissed: false },
            "-created_date"
          )
        : [],
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => ChallengeNotification.update(id, { dismissed: true }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["challenge-notifications", userEmail] }),
  });

  useEffect(() => {
    onActiveChange?.(notifications.length > 0);
  }, [notifications.length, onActiveChange]);

  if (!notifications.length) return null;

  // Show the most recent undismissed notification
  const notif = notifications[0];

  return (
    <Link to="/Social" state={{ selectGroup: notif.group_id }} className="block mb-4">
      <div className="rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <Trophy className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground truncate">
            {notif.started_by_name || "Someone"} started a new challenge: {notif.habit_name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {notif.duration_days} days · {notif.group_name} · Tap to view
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
    </Link>
  );
}