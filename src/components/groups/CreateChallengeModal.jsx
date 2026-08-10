import React, { useState } from "react";
import { format, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const DURATIONS = [
  { days: 7, label: "7 Days", sublabel: "1 week sprint" },
  { days: 14, label: "14 Days", sublabel: "2 week push" },
  { days: 30, label: "30 Days", sublabel: "Monthly challenge" },
];

export default function CreateChallengeModal({ open, onOpenChange, group, onCreate, userHabits = [] }) {
  const activeHabits = userHabits.filter((h) => !h.archived);
  const [habitId, setHabitId] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(7);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!habitId) return;
    setLoading(true);
    const end = format(addDays(new Date(startDate + "T00:00:00"), duration - 1), "yyyy-MM-dd");
    // habit_name is intentionally not sent here -- the group_challenges_
    // set_habit_name trigger derives it server-side from habit_id, the
    // only place it's now considered authoritative.
    await onCreate({
      group_id: group.id,
      habit_id: habitId,
      description: description.trim() || undefined,
      duration_days: duration,
      start_date: startDate,
      end_date: end,
      member_emails: group.member_emails || [],
      is_active: true,
    });
    setLoading(false);
    setHabitId("");
    setDescription("");
    setDuration(7);
    setStartDate(format(new Date(), "yyyy-MM-dd"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-accent" />
            New Group Challenge
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Habit to track</Label>
            {activeHabits.length > 0 ? (
              <select
                value={habitId}
                onChange={(e) => setHabitId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select a habit…</option>
                {activeHabits.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add a habit first — challenges track one of your existing habits.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Duration</Label>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.days}
                  onClick={() => setDuration(d.days)}
                  className={cn(
                    "rounded-xl border-2 p-2.5 text-center transition-all",
                    duration === d.days
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-muted hover:bg-muted/80"
                  )}
                >
                  <p className="text-sm font-bold">{d.label}</p>
                  <p className="text-[10px] text-muted-foreground">{d.sublabel}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Description (optional)</Label>
            <Textarea
              placeholder="What's this challenge about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-20 resize-none text-sm"
            />
          </div>

          <Button
            className="w-full gap-2"
            onClick={handleSubmit}
            disabled={!habitId || loading}
          >
            <Trophy className="w-4 h-4" />
            {loading ? "Creating..." : "Launch Challenge"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
