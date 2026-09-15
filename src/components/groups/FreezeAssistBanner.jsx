import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FreezeAssistNotification } from "@/api/entities";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3 mb-4"
      style={{ backgroundColor: "hsl(var(--frozen) / 0.1)", borderColor: "hsl(var(--frozen) / 0.25)" }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-lg"
        style={{ backgroundColor: "hsl(var(--frozen) / 0.2)" }}
      >
        ❄️
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-foreground truncate">
          {notif.assister_name || "A friend"} saved your streak on {notif.habit_name}!
        </p>
        <p className="text-[11px] text-muted-foreground">
          Your Pro friend used one of their own freezes -- yours are untouched.
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0 h-7 w-7 rounded-full hover:bg-foreground/10"
        onClick={() => dismissMutation.mutate(notif.id)}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}
