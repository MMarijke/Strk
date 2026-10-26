import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Flame, TrendingUp, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/routeModules";

const TABS = [
  { path: "/Dashboard", label: "Habits",  Icon: Flame },
  { path: "/Trends",    label: "Trends",  Icon: TrendingUp },
  { path: "/Social",    label: "Social",  Icon: Users },
  { path: "/Settings",  label: "Settings", Icon: Settings },
];

export default function BottomTabBar({ unreadReactions = 0 }) {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch max-w-2xl mx-auto">
        {TABS.map(({ path, label, Icon }) => {
          const active = pathname === path || pathname.startsWith(path + "/");
          const showBadge = path === "/Social" && unreadReactions > 0;
          // onPointerDown, not onClick: it fires on finger-down, which is
          // tens to low hundreds of milliseconds before the tap completes
          // and navigation commits. That head start is often the whole
          // chunk fetch on a warm connection. Covers the case where a tap
          // beats the idle prefetch -- the first tab tapped immediately
          // after launch, or one the warm-up has not reached yet.
          // Already-loaded paths are a no-op.
          return (
            <Link
              key={path}
              to={path}
              className="flex-1"
              onPointerDown={() => prefetchRoute(path)}
            >
              <div className={cn(
                "flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}>
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {showBadge && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive" />
                  )}
                </div>
                <span className={cn("text-[10px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                  {label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}