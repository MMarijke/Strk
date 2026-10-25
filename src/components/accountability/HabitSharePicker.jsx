import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Habit } from "@/api/entities";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Pick which of your own habits a partner may see.
 *
 * Used by both consent surfaces -- the invite modal and the accept screen
 * -- because they are asking the same question from opposite ends, and a
 * second copy would be where the two drift apart.
 *
 * Nothing is pre-selected. A pre-ticked list is consent the user never
 * gave, and the caller's button label states the consequence instead
 * (see the `selected.length` copy in both callers), so refusing to share
 * stays an available, visible choice rather than something the UI has
 * quietly decided for them.
 *
 * Rows are their own label element at 44px, so the whole row is the
 * target rather than the checkbox alone.
 */
export default function HabitSharePicker({ userEmail, selected = [], onChange, disabled = false, labelledBy }) {
  const { data: habits = [], isLoading, isError } = useQuery({
    queryKey: ["habits", userEmail],
    queryFn: () => (userEmail ? Habit.filter({ created_by: userEmail }, "-created_date") : []),
    enabled: !!userEmail,
  });

  // Archived habits are deliberately absent: the dashboard filters them
  // out, so sharing one would leave the owner believing they had shared
  // something the partner can never see. The RPC rejects them too.
  const active = habits.filter((h) => !h.archived);

  const toggle = (id) => {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  if (isLoading) {
    return (
      <div className="space-y-1.5" role="status" aria-label="Loading your habits">
        {[1, 2, 3].map((i) => <div key={i} className="h-11 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive-text" role="alert">
        Couldn&apos;t load your habits. You can pair now and choose what to share afterwards.
      </p>
    );
  }

  // Not "no habits yet" phrased as a failure: there is nothing wrong with
  // pairing first. The caller still allows sending.
  if (active.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        You don&apos;t have any habits to share yet. You can still pair, and choose what to share once you do.
      </p>
    );
  }

  // The visible heading above each instance names the group, so it is
  // referenced rather than restated -- an aria-label here would override
  // that heading with a duplicate of it. The fallback only covers a caller
  // that has no heading to point at.
  return (
    <div
      className="space-y-1.5 max-h-52 overflow-y-auto"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Habits to share"}
    >
      {active.map((h) => {
        const checked = selected.includes(h.id);
        return (
          <label
            key={h.id}
            className={cn(
              "w-full min-h-11 flex items-center gap-3 rounded-xl border-2 px-3 py-2 cursor-pointer transition-all",
              "focus-within:ring-1 focus-within:ring-ring",
              checked ? "border-primary bg-primary/5" : "border-transparent bg-muted hover:bg-muted/80",
              disabled && "opacity-60 cursor-not-allowed"
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => toggle(h.id)}
              disabled={disabled}
              aria-label={`Share ${h.name}`}
            />
            <span className="text-sm font-medium truncate">{h.name}</span>
          </label>
        );
      })}
    </div>
  );
}
