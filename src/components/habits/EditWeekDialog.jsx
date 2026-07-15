import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format, subDays, isSameDay } from "date-fns";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export default function EditWeekDialog({ open, onOpenChange, habit, onSave, frozenDate }) {
  const color = habit?.color || "hsl(152, 55%, 42%)";
  const today = new Date();

  // Last 14 days including today
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = subDays(today, 13 - i);
    return { date, dateStr: format(date, "yyyy-MM-dd"), isToday: isSameDay(date, today) };
  });

  const [selected, setSelected] = useState(new Set(habit?.completions || []));

  const toggle = (dateStr) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
      return next;
    });
  };

  const handleSave = () => {
    onSave(Array.from(selected));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Edit Completions</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Tap days to toggle completion. Last 14 days shown.
        </p>

        <div className="grid grid-cols-7 gap-2 py-2">
          {/* Day of week headers */}
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-[11px] font-semibold text-muted-foreground text-center">
              {d}
            </div>
          ))}

          {/* Blank cells to align first day */}
          {Array.from({ length: (new Date(days[0].date).getDay()) }).map((_, i) => (
            <div key={`b-${i}`} />
          ))}

          {days.map(({ date, dateStr, isToday }) => {
            const done = selected.has(dateStr);
            const isFrozen = frozenDate === dateStr && !done;
            return (
              <button
                key={dateStr}
                onClick={() => !isFrozen && toggle(dateStr)}
                className={cn(
                  "relative aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all duration-200 text-xs font-medium",
                  done ? "text-white shadow-sm" : isFrozen ? "text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70",
                  isToday && !done && !isFrozen && "ring-2 ring-offset-1 ring-border font-bold",
                  isFrozen && "cursor-default"
                )}
                style={done ? { backgroundColor: color } : isFrozen ? { backgroundColor: "#3b82f6" } : undefined}
                title={isFrozen ? "Streak freeze applied" : format(date, "EEE, MMM d")}
              >
                <span className="text-[11px] leading-none">{format(date, "d")}</span>
                <span className="text-[9px] leading-none opacity-70">{format(date, "MMM")}</span>
                {done && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg">
                    <Check className="w-4 h-4 text-white/80" strokeWidth={3} />
                  </div>
                )}
                {isFrozen && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg">
                    <span className="text-sm">❄️</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg p-3 flex-wrap">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
          <span>= completed &nbsp;·&nbsp;</span>
          <div className="w-4 h-4 rounded bg-background border border-border" />
          <span>= not completed &nbsp;·&nbsp;</span>
          <span>❄️</span>
          <span>= frozen</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}