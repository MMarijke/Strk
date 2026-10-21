import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Group, Habit } from "@/api/entities";
import { useQuery } from "@tanstack/react-query";
import { startFocusSession, LOBBY_MINUTES } from "@/lib/focusSessionStart";

const DURATIONS = [25, 45, 60];

export default function StartFocusModal({ open, onOpenChange, userEmail, userName, onSessionCreated }) {
  const [duration, setDuration] = useState(25);
  const [groupId, setGroupId] = useState("");
  const [habitId, setHabitId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: groups = [] } = useQuery({
    queryKey: ["groups", userEmail],
    queryFn: () => userEmail
      ? Group.filter({ '$or': [{ created_by: userEmail }, { member_emails: { '$in': [userEmail] } }] }, "-created_date")
      : [],
    enabled: !!userEmail,
  });

  // Same query key and staleTime as Dashboard/Social/GroupDashboard, so
  // this shares their cache entry rather than adding a fetch.
  const { data: allHabits = [] } = useQuery({
    queryKey: ["habits", userEmail],
    queryFn: () => userEmail ? Habit.filter({ created_by: userEmail }, "-created_date") : [],
    enabled: !!userEmail,
    staleTime: 5 * 60 * 1000,
  });
  // Archived habits are ones the user has stopped tracking; attaching a
  // session to one would silently revive its streak.
  const habits = allHabits.filter((h) => !h.archived);
  const selectedHabit = habits.find((h) => h.id === habitId);

  const handleStart = async () => {
    setLoading(true);
    try {
      // Creation and group notification both live in
      // lib/focusSessionStart.js, shared with GroupDashboard's
      // "Sit with us now" -- one path for one row, so the two cannot
      // drift on what a session looks like or who gets told about it.
      //
      // The habit rides along rather than being set here: habit_id is
      // necessarily the HOST's habit (habits_select_own is owner-only, so
      // no client can resolve anyone else's) and habit_name is a frozen
      // snapshot each other participant's client matches against their own
      // habits -- the same pattern group_challenges uses (20260810090001)
      // for the same reason.
      const session = await startFocusSession({
        userEmail,
        userName,
        group: groups.find((g) => g.id === groupId) || null,
        durationMinutes: duration,
        habit: selectedHabit || null,
      });
      onOpenChange(false);
      onSessionCreated(session);
    } catch (err) {
      console.error("Failed to start focus session:", err);
      toast.error("Couldn't start the session. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
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

          {/* Habit (optional) -- same weight and optional-ness as the
              group selector above it. A session with no habit behaves
              exactly as it always has. */}
          {habits.length > 0 && (
            <div>
              <label htmlFor="focus-habit" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Counts toward (optional)
              </label>
              <select
                id="focus-habit"
                value={habitId}
                onChange={(e) => setHabitId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No habit</option>
                {habits.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
              {selectedHabit && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Finishing this session marks {selectedHabit.name} done for everyone who tracks it.
                </p>
              )}
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