import React, { useState } from "react";
import { format, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trophy, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const DURATIONS = [
  { days: 7, label: "7 Days", sublabel: "1 week sprint" },
  { days: 14, label: "14 Days", sublabel: "2 week push" },
  { days: 30, label: "30 Days", sublabel: "Monthly challenge" },
];

// Free stays limited to the 3 presets above; Pro can pick any length. Both
// enforced server-side too (enforce_challenge_duration_plan_limit_trigger,
// 20260915090002) -- this UI gate is convenience, not the real boundary.
const CUSTOM_DURATION_MIN = 1;
const CUSTOM_DURATION_MAX = 365;

export default function CreateChallengeModal({ open, onOpenChange, group, onCreate, userHabits = [], isPro = false, onUpgradeClick }) {
  const activeHabits = userHabits.filter((h) => !h.archived);
  const [habitId, setHabitId] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(7);
  const [customDuration, setCustomDuration] = useState(false);
  const [customDays, setCustomDays] = useState(21);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);

  const effectiveDuration = customDuration
    ? Math.min(CUSTOM_DURATION_MAX, Math.max(CUSTOM_DURATION_MIN, Number(customDays) || CUSTOM_DURATION_MIN))
    : duration;

  const handleSubmit = async () => {
    if (!habitId) return;
    setLoading(true);
    const end = format(addDays(new Date(startDate + "T00:00:00"), effectiveDuration - 1), "yyyy-MM-dd");
    // habit_name is intentionally not sent here -- the group_challenges_
    // set_habit_name trigger derives it server-side from habit_id, the
    // only place it's now considered authoritative.
    await onCreate({
      group_id: group.id,
      habit_id: habitId,
      description: description.trim() || undefined,
      duration_days: effectiveDuration,
      start_date: startDate,
      end_date: end,
      member_emails: group.member_emails || [],
      is_active: true,
    });
    setLoading(false);
    setHabitId("");
    setDescription("");
    setDuration(7);
    setCustomDuration(false);
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
                Add a habit first. Challenges track one of your existing habits.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Duration</Label>
            <div className="grid grid-cols-4 gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.days}
                  onClick={() => { setDuration(d.days); setCustomDuration(false); }}
                  className={cn(
                    "rounded-xl border-2 p-2.5 text-center transition-all",
                    !customDuration && duration === d.days
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-muted hover:bg-muted/80"
                  )}
                >
                  <p className="text-sm font-bold">{d.label}</p>
                  <p className="text-[10px] text-muted-foreground">{d.sublabel}</p>
                </button>
              ))}
              <button
                onClick={() => (isPro ? setCustomDuration(true) : onUpgradeClick?.())}
                className={cn(
                  "rounded-xl border-2 p-2.5 text-center transition-all",
                  customDuration
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                )}
              >
                <p className="text-sm font-bold flex items-center justify-center gap-1">
                  Custom {!isPro && <Lock className="w-3 h-3 text-muted-foreground" />}
                </p>
                <p className="text-[10px] text-muted-foreground">{isPro ? "Any length" : "Pro only"}</p>
              </button>
            </div>
            {customDuration && isPro && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="number"
                  min={CUSTOM_DURATION_MIN}
                  max={CUSTOM_DURATION_MAX}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="h-9 w-24"
                />
                <span className="text-xs text-muted-foreground">days (1–365)</span>
              </div>
            )}
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
