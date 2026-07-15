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
  const [habitName, setHabitName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(7);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!habitName.trim()) return;
    setLoading(true);
    const end = format(addDays(new Date(startDate + "T00:00:00"), duration - 1), "yyyy-MM-dd");
    await onCreate({
      group_id: group.id,
      habit_name: habitName.trim(),
      description: description.trim() || undefined,
      duration_days: duration,
      start_date: startDate,
      end_date: end,
      member_emails: group.member_emails || [],
      is_active: true,
    });
    setLoading(false);
    setHabitName("");
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
            <Input
              placeholder="e.g. Morning Run, Read 20 Pages, Meditate..."
              value={habitName}
              onChange={(e) => setHabitName(e.target.value)}
            />
            {userHabits.filter((h) => !h.archived).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {userHabits.filter((h) => !h.archived).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setHabitName(h.name)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full border transition-all",
                      habitName === h.name
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
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
            disabled={!habitName.trim() || loading}
          >
            <Trophy className="w-4 h-4" />
            {loading ? "Creating..." : "Launch Challenge"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}