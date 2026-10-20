import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RotateCcw, CalendarRange, AlertTriangle } from "lucide-react";
import { cn, HABIT_COLORS, HABIT_COLOR_NAMES } from "@/lib/utils";

const CATEGORIES = [
  { value: "health", label: "🍎 Health" },
  { value: "fitness", label: "💪 Fitness" },
  { value: "mindfulness", label: "🧘 Mindfulness" },
  { value: "learning", label: "📚 Learning" },
  { value: "productivity", label: "⚡ Productivity" },
  { value: "social", label: "🤝 Social" },
  { value: "other", label: "✨ Other" },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7];

export default function EditHabitModal({ open, onOpenChange, habit, onSave, onArchive, onDelete }) {
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [color, setColor] = useState(HABIT_COLORS[0]);
  const [description, setDescription] = useState("");
  const [goalPerWeek, setGoalPerWeek] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("08:00");
  const [reminderDays, setReminderDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [category, setCategory] = useState("");

  const [showFreqWarning, setShowFreqWarning] = useState(false);
  const [pendingFrequency, setPendingFrequency] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pre-fill from habit
  useEffect(() => {
    if (!habit) return;
    setName(habit.name || "");
    setFrequency(habit.frequency || "daily");
    setColor(habit.color || HABIT_COLORS[0]);
    setDescription(habit.description || "");
    setGoalPerWeek(habit.goal_per_week ? String(habit.goal_per_week) : "");
    setReminderEnabled(!!habit.reminder_time);
    setReminderTime(habit.reminder_time || "08:00");
    setReminderDays(habit.reminder_days || [0, 1, 2, 3, 4, 5, 6]);
    setCategory(habit.category || "");
    setConfirmArchive(false);
    setConfirmDelete(false);
    setShowFreqWarning(false);
    setPendingFrequency(null);
  }, [habit, open]);

  const hasStreak = (habit?.completions || []).length > 0;

  const handleFrequencyClick = (f) => {
    if (f !== frequency && hasStreak) {
      setPendingFrequency(f);
      setShowFreqWarning(true);
    } else {
      setFrequency(f);
    }
  };

  const toggleReminderDay = (day) => {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      frequency,
      color,
      description: description.trim() || null,
      goal_per_week: goalPerWeek ? Number(goalPerWeek) : null,
      reminder_time: reminderEnabled ? reminderTime : null,
      reminder_days: reminderEnabled ? reminderDays : null,
      category: category || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Edit Habit</DialogTitle>
        </DialogHeader>

        {/* Frequency warning */}
        {showFreqWarning && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex gap-3 items-start">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-300">Changing frequency may affect your current streak. Continue?</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => { setFrequency(pendingFrequency); setShowFreqWarning(false); setPendingFrequency(null); }}>
                  Yes, change it
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowFreqWarning(false); setPendingFrequency(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Habit name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Frequency</Label>
            <div className="grid grid-cols-2 gap-2">
              {["daily", "weekly"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleFrequencyClick(f)}
                  className={cn(
                    "h-11 rounded-xl text-sm font-semibold border-2 transition-all duration-200 capitalize flex items-center justify-center gap-2",
                    frequency === f
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {f === "daily" ? <><RotateCcw className="w-4 h-4" /> Daily</> : <><CalendarRange className="w-4 h-4" /> Weekly</>}
                </button>
              ))}
            </div>
          </div>

          {/* Goal per week (when weekly) */}
          {frequency === "weekly" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Times per week</Label>
              <div className="flex gap-2 flex-wrap">
                {DAYS_PER_WEEK.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setGoalPerWeek(String(d))}
                    className={cn(
                      "w-10 h-10 rounded-xl text-sm font-semibold border-2 transition-all",
                      goalPerWeek === String(d)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {HABIT_COLORS.map((c, i) => (
                // See AddHabitDialog.jsx's identical swatch picker for why
                // the 44px hit target is this outer button, not padding on
                // the fixed-size w-8 h-8 visible circle.
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={HABIT_COLOR_NAMES[i]}
                  aria-pressed={color === c}
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "w-8 h-8 rounded-full transition-all duration-200",
                      color === c ? "ring-2 ring-offset-2 ring-offset-background scale-110" : "hover:scale-105"
                    )}
                    style={{ backgroundColor: c }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reminder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Reminder</Label>
              <button
                type="button"
                onClick={() => setReminderEnabled(!reminderEnabled)}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  reminderEnabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span className={cn(
                  "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                  reminderEnabled ? "translate-x-4" : "translate-x-1"
                )} />
              </button>
            </div>
            {reminderEnabled && (
              <div className="space-y-3 pl-1">
                <Input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="h-10 w-36"
                />
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleReminderDay(i)}
                      className={cn(
                        "w-8 h-8 rounded-full text-xs font-semibold border-2 transition-all",
                        reminderDays.includes(i)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

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

          {/* Save */}
          <Button className="w-full" onClick={handleSave} disabled={!name.trim()}>
            Save Changes
          </Button>

          {/* Divider + destructive actions */}
          <div className="border-t border-border pt-4 space-y-2">
            {/* Archive */}
            {!confirmArchive ? (
              <Button
                variant="outline"
                className="w-full text-muted-foreground"
                onClick={() => setConfirmArchive(true)}
              >
                Archive Habit
              </Button>
            ) : (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-sm text-center text-foreground">
                  Archive <span className="font-semibold">{habit?.name}</span>? You can restore it from Settings.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-9" onClick={() => setConfirmArchive(false)}>Cancel</Button>
                  <Button className="flex-1 h-9" onClick={() => { onArchive(habit.id); onOpenChange(false); }}>Archive</Button>
                </div>
              </div>
            )}

            {/* Delete */}
            {!confirmDelete ? (
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}
              >
                Delete Habit
              </Button>
            ) : (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                <p className="text-sm text-center text-destructive">
                  Delete <span className="font-semibold">{habit?.name}</span>? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-9" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1 h-9" onClick={() => { onDelete(habit.id); onOpenChange(false); }}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}