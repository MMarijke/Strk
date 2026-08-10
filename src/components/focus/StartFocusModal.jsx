import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Group, FocusSession } from "@/api/entities";
import { addMinutes, formatISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { trackEvent } from "@/lib/analytics";

const DURATIONS = [25, 45, 60];
const LOBBY_MINUTES = 2;

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function StartFocusModal({ open, onOpenChange, userEmail, userName, onSessionCreated }) {
  const [duration, setDuration] = useState(25);
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: groups = [] } = useQuery({
    queryKey: ["groups", userEmail],
    queryFn: () => userEmail
      ? Group.filter({ '$or': [{ created_by: userEmail }, { member_emails: { '$in': [userEmail] } }] }, "-created_date")
      : [],
    enabled: !!userEmail,
  });

  const handleStart = async () => {
    setLoading(true);
    const now = new Date();
    // started_at/ends_at are intentionally left unset here -- they're set
    // by start_focus_session_now() when the lobby actually ends (natural
    // elapse or host force-start), so the real focus timer counts from
    // when it truly begins rather than from session creation.
    const session = await FocusSession.create({
      host_email: userEmail,
      host_name: userName,
      group_id: groupId || undefined,
      duration_minutes: duration,
      lobby_ends_at: formatISO(addMinutes(now, LOBBY_MINUTES)),
      status: "waiting",
      participant_emails: [userEmail],
      session_code: genCode(),
    });
    trackEvent("focus_session_started");
    setLoading(false);
    onOpenChange(false);
    onSessionCreated(session);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Start Focus Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Duration */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Duration</p>
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={cn(
                    "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all border",
                    duration === d
                      ? "bg-primary text-primary-foreground border-primary shadow"
                      : "bg-muted text-muted-foreground border-transparent hover:border-border"
                  )}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Group (optional) */}
          {groups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Group (optional)</p>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-center">
              Friends get {LOBBY_MINUTES} minutes to join before this starts
            </p>
            <Button className="w-full rounded-xl h-11 font-semibold" onClick={handleStart} disabled={loading}>
              {loading ? "Starting…" : "Start Session 🎯"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}