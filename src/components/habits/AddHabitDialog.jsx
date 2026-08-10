import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp, RotateCcw, CalendarRange } from "lucide-react";
import { cn, HABIT_COLORS } from "@/lib/utils";
import ReminderSection from "./ReminderSection";

const CATEGORIES = [
  { value: "health", label: "🍎 Health" },
  { value: "fitness", label: "💪 Fitness" },
  { value: "mindfulness", label: "🧘 Mindfulness" },
  { value: "learning", label: "📚 Learning" },
  { value: "productivity", label: "⚡ Productivity" },
  { value: "social", label: "🤝 Social" },
  { value: "other", label: "✨ Other" },
];

const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7];

export default function AddHabitDialog({ open, onOpenChange, onAdd }) {
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [color, setColor] = useState(HABIT_COLORS[0]);
  const [showSpecifics, setShowSpecifics] = useState(false);
  const [description, setDescription] = useState("");
  const [goalPerWeek, setGoalPerWeek] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [reminderDays, setReminderDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [category, setCategory] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      color,
      frequency,
      completions: [],
      ...(description.trim() && { description: description.trim() }),
      ...(goalPerWeek && { goal_per_week: Number(goalPerWeek) }),
      ...(reminderTime && { reminder_time: reminderTime, reminder_days: reminderDays }),
      ...(category && { category }),
    });
    // Reset
    setName(""); setFrequency("daily"); setColor(HABIT_COLORS[0]); setShowSpecifics(false);
    setDescription(""); setGoalPerWeek(""); setReminderTime(""); setReminderDays([0,1,2,3,4,5,6]); setCategory("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">New Habit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="habit-name" className="text-sm font-medium">
              What habit do you want to build?
            </Label>
            <Input
              id="habit-name"
              placeholder="e.g. Meditate, Read, Exercise..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              autoFocus
            />
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Frequency</Label>
            <div className="grid grid-cols-2 gap-2">
              {["daily", "weekly"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={cn(
                    "h-11 rounded-xl text-sm font-semibold border-2 transition-all duration-200 capitalize flex items-center justify-center gap-2",
                    frequency === f
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {f === "daily"
                    ? <><RotateCcw className="w-4 h-4" /> Daily</>
                    : <><CalendarRange className="w-4 h-4" /> Weekly</>
                  }
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Color</Label>
            <div className="flex gap-2">
              {HABIT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-full transition-all duration-200",
                    color === c ? "ring-2 ring-offset-2 ring-offset-background scale-110" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Specifics toggle */}
          <button
            type="button"
            onClick={() => setShowSpecifics(!showSpecifics)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSpecifics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showSpecifics ? "Hide specifics" : "Add specifics (optional)"}
          </button>

          {showSpecifics && (
            <div className="space-y-4 border-t border-border pt-4">
              {/* Description */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Description / Motivation</Label>
                <Textarea
                  placeholder="Why does this habit matter to you?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="resize-none h-20 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Goal per week */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Goal (days/week)</Label>
                  <Select value={goalPerWeek} onValueChange={setGoalPerWeek}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Any day" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_PER_WEEK.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d === 7 ? "Every day" : `${d}x / week`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Reminder time */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Reminder time</Label>
                  <Input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Category</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "h-10 rounded-xl text-sm font-semibold border-2 transition-all duration-200 flex items-center justify-center gap-1.5",
                        category === c.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reminder */}
              <ReminderSection
                reminderTime={reminderTime}
                reminderDays={reminderDays}
                onChange={({ reminderTime: rt, reminderDays: rd }) => {
                  if (rt !== undefined) setReminderTime(rt);
                  if (rd !== undefined) setReminderDays(rd);
                }}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Habit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}