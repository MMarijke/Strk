import React from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shared shell for TodayTray's rotating notification-style banners (freeze
// prompt, freeze assist, challenge start, focus invite, focus active).
// These five are the same visual concept -- an icon tile, a title/subtitle
// pair, an optional dismiss -- but had each reimplemented it independently:
// one used a gradient background, two used a flat tint, one used raw
// inline hsl(var(--frozen)) styles instead of a Tailwind class, and icon
// tile size, text sizes, and dismiss-button treatment all drifted slightly
// between them despite being the same component in spirit. This fixes that
// at the shared-component level rather than patching each call site to
// merely match pixel values.
//
// `tone` carries real meaning, not just decoration: "frozen" is the same
// --frozen token StreakWidget/EditWeekDialog/FreezeConfirmModal already use
// for anything freeze-related, kept distinct from the warm primary/accent
// "brand" tone used for everything else, so a freeze-themed notification
// reads as part of that same cold-blue family wherever it appears.
const TONES = {
  brand: {
    container: "bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20",
    tile: "bg-primary/15",
  },
  frozen: {
    container: "bg-frozen/10 border-frozen/25",
    tile: "bg-frozen/20",
  },
};

export default function NotificationBanner({
  tone = "brand",
  icon,
  title,
  subtitle,
  indicator,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  onClick,
  to,
  linkState,
  className,
}) {
  const t = TONES[tone] || TONES.brand;
  const clickable = Boolean(to || onClick);

  const content = (
    <>
      {icon && (
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", t.tile)}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-foreground truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
      </div>
      {indicator}
      {action}
      {onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 h-7 w-7 rounded-full hover:bg-foreground/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={dismissLabel}
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      )}
    </>
  );

  const containerClass = cn(
    "rounded-xl border px-4 py-3 flex items-center gap-3 mb-4",
    t.container,
    clickable && "hover:shadow-md transition-shadow",
    className
  );

  if (to) {
    return (
      <Link to={to} state={linkState} className={cn("block", containerClass)}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        }}
        className={cn(containerClass, "cursor-pointer")}
      >
        {content}
      </div>
    );
  }

  return <div className={containerClass}>{content}</div>;
}
