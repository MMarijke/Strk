import React, { useState } from "react";
import { format } from "date-fns";
import { Check, BarChart2, CalendarDays, Clock, Target, Tag, Bell, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, HABIT_COLORS } from "@/lib/utils";
import StreakWidget from "./StreakWidget";
import MonthlyReportDialog from "./MonthlyReportDialog";
import EditWeekDialog from "./EditWeekDialog";
import MilestoneBadges from "./MilestoneBadges";
import { calculateStreak } from "./StreakWidget";
import EditReminderDialog from "./EditReminderDialog";
import FreezeConfirmModal from "./FreezeConfirmModal";
import EditHabitModal from "./EditHabitModal";
import { getFreezeEligibleDate } from "@/lib/freezeService";

const CATEGORY_LABELS = {
  health: "🍎 Health", fitness: "💪 Fitness", mindfulness: "🧘 Mindfulness",
  learning: "📚 Learning", productivity: "⚡ Productivity", social: "🤝 Social", other: "✨ Other",
};

// frozenDate/freezesRemaining come from Dashboard.jsx's single
// getFreezeMonthState() call, not fetched per-card -- every HabitCard
// used to independently re-fetch the same one streak_freezes row via its
// own useEffect, 2 requests per card, on every dashboard load.
export default function HabitCard({ habit, onToggleToday, onDelete, onUpdateCompletions, onUpdateReminder, onApplyFreeze, onUpdate, onArchive, userEmail, isPro, isToggling = false, frozenDate = null, freezesRemaining = 0, isHighlighted = false }) {
  const [showReport, setShowReport] = useState(false);
  const [showEditWeek, setShowEditWeek] = useState(false);
  const [showEditReminder, setShowEditReminder] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");
  const completions = habit.completions || [];
  const isDoneToday = completions.includes(today);
  const color = habit.color || HABIT_COLORS[0];
  const streak = calculateStreak(completions, frozenDate);
  const freezeEligibleDate = userEmail ? getFreezeEligibleDate(habit) : null;
  const canShowFreezePrompt = freezeEligibleDate && !frozenDate;

  const hasSpecifics = habit.description || habit.goal_per_week || habit.reminder_time || habit.category;

  return (
    <>
      <Card
        className={cn(
          "group relative overflow-hidden border-0 shadow-sm hover:shadow-md transition-all duration-300 bg-card cursor-pointer",
          isHighlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        onClick={() => setActionsVisible((v) => !v)}
      >
        <div className="absolute top-0 left-0 w-1 h-full rounded-l-lg" style={{ backgroundColor: color }} />

        <div className="p-5 pl-6">
          {/* Top row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-[15px] text-foreground text-left break-words">
                  {habit.name}
                </p>
                {habit.reminder_time && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowEditReminder(true); }}
                    className="hover:scale-110 transition-transform shrink-0"
                    style={{ color }}
                    title="Edit reminder"
                  >
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                )}
                {habit.category && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {CATEGORY_LABELS[habit.category]}
                  </span>
                )}
              </div>

              {habit.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{habit.description}</p>
              )}

              <div className="mt-3">
                <StreakWidget completions={completions} color={color} frozenDate={frozenDate} />
              </div>
              <div className="mt-2">
                <MilestoneBadges completions={completions} currentStreak={streak} />
              </div>

              {/* Freeze prompt */}
              {canShowFreezePrompt && (
                <div className="mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowFreezeModal(true); }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
                      (isPro || freezesRemaining > 0)
                        ? "font-semibold bg-gradient-to-r from-primary/15 to-accent/15 border border-primary/25 text-primary hover:from-primary/25 hover:to-accent/25"
                        : "font-medium bg-muted/60 text-muted-foreground/70 border border-transparent"
                    )}
                  >
                    <span>❄️</span>
                    {isPro ? "Freeze streak (Pro)" : freezesRemaining > 0 ? "Freeze?" : "No freezes left this month"}
                  </button>
                  {/* Reassurance for the one moment this card has no good
                      news: streak broke and there's no freeze left to
                      save it. Every other outcome (rank up, freeze
                      applied) gets a celebratory moment elsewhere in the
                      app -- this was previously the one silent valley. */}
                  {!isPro && freezesRemaining <= 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">
                      No freezes left, but today's a clean slate — check in to start a new streak.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Secondary action buttons — visible when card is tapped */}
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 transition-all text-muted-foreground hover:text-foreground", actionsVisible ? "opacity-100" : "opacity-0 pointer-events-none")}
                onClick={(e) => { e.stopPropagation(); setShowEdit(true); setActionsVisible(false); }}
                title="Edit habit"
              >
                <Settings2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 transition-all text-muted-foreground hover:text-foreground", actionsVisible ? "opacity-100" : "opacity-0 pointer-events-none")}
                onClick={(e) => { e.stopPropagation(); setShowEditWeek(true); setActionsVisible(false); }}
                title="Edit completions"
              >
                <CalendarDays className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 transition-all text-muted-foreground hover:text-foreground", actionsVisible ? "opacity-100" : "opacity-0 pointer-events-none")}
                onClick={(e) => { e.stopPropagation(); setShowReport(true); setActionsVisible(false); }}
                title="Monthly report"
              >
                <BarChart2 className="w-4 h-4" />
              </Button>
              {/* Check button -- disabled while isToggling so two rapid
                  taps can't race: handleToggleToday reads completions off
                  the habit prop at click time, so a second tap before the
                  first write lands would compute the same "toggle to X"
                  twice instead of a true toggle/untoggle pair. */}
              <button
                onClick={(e) => { e.stopPropagation(); if (!isToggling) onToggleToday(habit); }}
                disabled={isToggling}
                className={cn(
                  "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 shrink-0",
                  isToggling && "opacity-60 cursor-not-allowed",
                  isDoneToday
                    ? "text-white shadow-lg"
                    : "bg-muted text-muted-foreground hover:scale-105 hover:bg-muted/80"
                )}
                style={isDoneToday ? { backgroundColor: color, boxShadow: `0 4px 14px ${color}40` } : undefined}
              >
                <Check className={cn("w-5 h-5 transition-transform", isDoneToday && "scale-110")} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Specifics row */}
          {hasSpecifics && (
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border/50">
              {habit.goal_per_week && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Target className="w-3 h-3" />
                  {habit.goal_per_week === 7 ? "Every day" : `${habit.goal_per_week}x/week`}
                </span>
              )}
              {habit.reminder_time && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {habit.reminder_time}
                </span>
              )}
              {habit.category && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
                  <Tag className="w-3 h-3" />
                  {CATEGORY_LABELS[habit.category]}
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      <MonthlyReportDialog
        open={showReport}
        onOpenChange={setShowReport}
        habit={habit}
      />
      <EditWeekDialog
        open={showEditWeek}
        onOpenChange={setShowEditWeek}
        habit={habit}
        onSave={(newCompletions) => onUpdateCompletions(habit.id, newCompletions)}
        frozenDate={frozenDate}
      />
      <EditReminderDialog
        open={showEditReminder}
        onOpenChange={setShowEditReminder}
        habit={habit}
        onSave={(data) => onUpdateReminder && onUpdateReminder(habit.id, data)}
      />
      <FreezeConfirmModal
        open={showFreezeModal}
        onOpenChange={setShowFreezeModal}
        habit={habit}
        freezesRemaining={freezesRemaining}
        isPro={isPro}
        onConfirm={() => onApplyFreeze && onApplyFreeze(habit.id, freezeEligibleDate)}
      />
      <EditHabitModal
        open={showEdit}
        onOpenChange={setShowEdit}
        habit={habit}
        onSave={(data) => onUpdate && onUpdate(habit.id, data)}
        onArchive={(id) => onArchive && onArchive(id)}
        onDelete={(id) => onDelete && onDelete(id)}
      />
    </>
  );
}