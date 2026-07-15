import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, getDay, subMonths, addMonths, isSameMonth,
} from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthlyReportDialog({ open, onOpenChange, habit }) {
  const [viewDate, setViewDate] = useState(new Date());
  const completions = habit?.completions || [];
  const color = habit?.color || "hsl(152, 55%, 42%)";

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Calendar completion map
  const completionSet = new Set(completions);

  // Day-of-week frequency for bar chart
  const dowCounts = Array(7).fill(0);
  completions.forEach((d) => {
    const date = new Date(d + "T00:00:00");
    if (isSameMonth(date, viewDate)) {
      dowCounts[getDay(date)]++;
    }
  });
  const barData = DAY_LABELS.map((label, i) => ({ label, count: dowCounts[i] }));
  const maxCount = Math.max(...dowCounts, 1);

  // Monthly completion rate
  const completedThisMonth = daysInMonth.filter((d) =>
    completionSet.has(format(d, "yyyy-MM-dd"))
  ).length;
  const rate = Math.round((completedThisMonth / daysInMonth.length) * 100);

  // Leading blank days for calendar grid
  const firstDow = getDay(monthStart);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Monthly Report</DialogTitle>
        </DialogHeader>

        {/* Month navigator */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => setViewDate(subMonths(viewDate, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-sm">{format(viewDate, "MMMM yyyy")}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewDate(addMonths(viewDate, 1))}
            disabled={isSameMonth(viewDate, new Date())}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Completion rate badge */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: color }}
          >
            {rate}%
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">
              {completedThisMonth} of {daysInMonth.length} days completed
            </p>
            <p className="text-xs text-muted-foreground">
              {rate >= 80 ? "Excellent consistency!" : rate >= 50 ? "Good progress, keep going!" : "Room to improve — you've got this!"}
            </p>
          </div>
        </div>

        {/* Calendar heatmap */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Calendar</p>
          <div className="grid grid-cols-7 gap-1 text-center">
            {DAY_LABELS.map((d) => (
              <div key={d} className="text-[10px] font-medium text-muted-foreground pb-1">{d}</div>
            ))}
            {/* blank leading cells */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {daysInMonth.map((day) => {
              const ds = format(day, "yyyy-MM-dd");
              const done = completionSet.has(ds);
              const isToday = ds === format(new Date(), "yyyy-MM-dd");
              return (
                <div
                  key={ds}
                  title={format(day, "MMM d")}
                  className={cn(
                    "aspect-square rounded-md flex items-center justify-center text-[11px] font-medium transition-all",
                    done ? "text-white" : "bg-muted text-muted-foreground",
                    isToday && !done && "ring-2 ring-offset-1 ring-border"
                  )}
                  style={done ? { backgroundColor: color } : undefined}
                >
                  {format(day, "d")}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bar chart: completions by day of week */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Completions by Day of Week
          </p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={barData} barSize={24}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={[0, maxCount + 1]} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-md">
                      <span className="font-semibold">{payload[0].value}</span>
                      <span className="text-muted-foreground ml-1">times</span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.count === maxCount && maxCount > 0 ? color : "hsl(var(--muted))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-1 text-center">
            {maxCount > 0
              ? `Most active on ${DAY_LABELS[dowCounts.indexOf(maxCount)]}s`
              : "No completions this month yet"}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}