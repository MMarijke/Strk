import React from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSocialActivity } from "@/hooks/useSocialActivity";

// Permanent, unconditional counterpart to StatsBar/RankCard/FreezeIndicator's
// solo gamification strip -- addresses the critique finding that this
// screen's only always-visible content was private score/streak data,
// with the product's actual social-accountability bet (reactions, groups)
// either conditional or buried several layers deep. Reuses the same
// ["reactions", email] / ["groups", email] react-query cache Social.jsx
// populates via useSocialActivity(), so this never becomes a second,
// independently-drifting fetch of the same data.
//
// Mirrors WeeklySummaryCard.jsx's focusable-card pattern (role="button" +
// tabIndex + onKeyDown), plus a themed focus-visible ring that pattern
// itself doesn't have yet -- new components shouldn't repeat a gap a
// prior critique pass already had to go back and fix elsewhere.
export default function FriendActivityStrip() {
  const navigate = useNavigate();
  const { groups, reactions, isLoading } = useSocialActivity();

  // Avoids a flash of the wrong state (e.g. invite CTA) before the first
  // fetch resolves -- same null-while-loading convention FreezeIndicator
  // already uses in this same screen.
  if (isLoading) return null;

  const hasReactions = reactions.length > 0;
  const hasGroups = groups.length > 0;
  const hasUnread = reactions.some((r) => !r.read);

  const goToSocial = (tab) => navigate("/Social", { state: { tab } });

  const baseClasses = cn(
    "flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm cursor-pointer",
    "transition-all hover:shadow-md",
    "outline-none focus-visible:ring-1 focus-visible:ring-ring"
  );

  const cardProps = (tab, label) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onClick: () => goToSocial(tab),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goToSocial(tab);
      }
    },
  });

  if (hasReactions) {
    const latest = reactions[0];
    const name = latest.sender_name || latest.sender_email?.split("@")[0] || "Someone";
    const moreCount = reactions.length - 1;

    return (
      <div className={baseClasses} {...cardProps("reactions", "View reactions from friends")}>
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
            {name[0].toUpperCase()}
          </div>
          {hasUnread && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-card" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">
            <span className="font-semibold">{name}</span>
            {" sent you "}
            <span className="text-base align-middle">{latest.emoji}</span>
            {moreCount > 0 && (
              <span className="text-muted-foreground"> · +{moreCount} more</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {latest.created_date
              ? formatDistanceToNow(parseISO(latest.created_date), { addSuffix: true })
              : "just now"}
          </p>
        </div>
      </div>
    );
  }

  if (hasGroups) {
    return (
      <div className={baseClasses} {...cardProps("reactions", "View your group")}>
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg shrink-0">
          🫶
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">No reactions yet</p>
          <p className="text-xs text-muted-foreground">
            When your group reacts to your streak, it'll show up here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={baseClasses} {...cardProps("groups", "Invite a friend to Strk")}>
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Share2 className="w-4 h-4 text-primary" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Invite a friend</p>
        <p className="text-xs text-muted-foreground">Habits stick better with someone watching</p>
      </div>
    </div>
  );
}
