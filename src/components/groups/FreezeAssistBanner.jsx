import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FreezeAssistNotification } from "@/api/entities";
import NotificationBanner from "@/components/dashboard/NotificationBanner";

// Mirrors ChallengeStartBanner.jsx's shape exactly -- same
// dedicated-table-per-notification-type pattern, same
// poll-via-React-Query delivery, same dismiss-only-column lockdown.
export default function FreezeAssistBanner({ userEmail, onActiveChange }) {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["freeze-assist-notifications", userEmail],
    queryFn: () =>
      userEmail
        ? FreezeAssistNotification.filter(
            { recipient_email: userEmail, dismissed: false },
            "-created_date"
          )
        : [],
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => FreezeAssistNotification.update(id, { dismissed: true }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["freeze-assist-notifications", userEmail] }),
  });

  useEffect(() => {
    onActiveChange?.(notifications.length > 0);
  }, [notifications.length, onActiveChange]);

  if (!notifications.length) return null;

  const notif = notifications[0];

  return (
    <NotificationBanner
      tone="frozen"
      icon={<span className="text-lg leading-none">❄️</span>}
      title={`${notif.assister_name || "A friend"} saved your streak on ${notif.habit_name}!`}
      subtitle="Your Pro friend used one of their own freezes -- yours are untouched."
      onDismiss={() => dismissMutation.mutate(notif.id)}
    />
  );
}
