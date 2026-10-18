import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChallengeNotification } from "@/api/entities";
import { Trophy } from "lucide-react";
import NotificationBanner from "@/components/dashboard/NotificationBanner";

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
    <NotificationBanner
      to="/Social"
      linkState={{ selectGroup: notif.group_id }}
      icon={<Trophy className="w-4 h-4 text-primary" />}
      title={`${notif.started_by_name || "Someone"} started a new challenge: ${notif.habit_name}`}
      subtitle={`${notif.duration_days} days · ${notif.group_name} · Tap to view`}
      onDismiss={() => dismissMutation.mutate(notif.id)}
    />
  );
}