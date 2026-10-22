import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Reaction } from "@/api/entities";
import BottomTabBar from "./BottomTabBar";
import FocusInviteListener from "@/components/focus/FocusInviteListener";
import AccountabilityNudgeListener from "@/components/accountability/AccountabilityNudgeListener";

// Pages that show the bottom tab bar
const TAB_PAGES = ["/Dashboard", "/Trends", "/Social", "/Settings", "/Badges"];

export default function AppLayout() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  const showTabs = TAB_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const { data: reactions = [] } = useQuery({
    queryKey: ["reactions", user?.email],
    queryFn: () => user?.email
      ? Reaction.filter({ recipient_email: user.email }, "-created_date")
      : [],
    enabled: !!user?.email,
  });
  const unreadReactions = reactions.filter((r) => !r.read).length;

  return (
    <div className="flex flex-col min-h-screen">
      {user?.email && <FocusInviteListener userEmail={user.email} />}
      {/* Mounted here rather than on Social for the same reason: a nudge
          sent while the recipient is on Dashboard or Trends used to be
          destroyed, because the only subscriber lived inside the Social
          page component. */}
      {user?.email && <AccountabilityNudgeListener userEmail={user.email} />}
      <main className={showTabs ? "pb-[calc(3.75rem_+_env(safe-area-inset-bottom))]" : ""}>
        <Outlet />
      </main>
      {showTabs && <BottomTabBar unreadReactions={unreadReactions} />}
    </div>
  );
}