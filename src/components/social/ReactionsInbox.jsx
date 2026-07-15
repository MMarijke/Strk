import React from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

export default function ReactionsInbox({ reactions }) {
  if (!reactions.length) {
    return (
      <div className="text-center py-10">
        <p className="text-3xl mb-2">🫶</p>
        <p className="text-sm font-medium text-foreground">No reactions yet</p>
        <p className="text-xs text-muted-foreground mt-1">When group members react to your streak, they'll appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {reactions.map((r) => (
        <div
          key={r.id}
          className={cn(
            "flex items-center gap-3 p-3 rounded-xl transition-colors",
            !r.read ? "bg-primary/5 ring-1 ring-primary/10" : "bg-muted/40"
          )}
        >
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
            {(r.sender_name || r.sender_email || "?")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{r.sender_name || r.sender_email?.split("@")[0]}</span>
              {" sent you "}
              <span className="text-base">{r.emoji}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {r.created_date
                ? formatDistanceToNow(parseISO(r.created_date), { addSuffix: true })
                : "just now"}
            </p>
          </div>
          {!r.read && (
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}