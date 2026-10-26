import React, { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Reaction } from "@/api/entities";
import BottomTabBar from "./BottomTabBar";
import FocusInviteListener from "@/components/focus/FocusInviteListener";
import AccountabilityNudgeListener from "@/components/accountability/AccountabilityNudgeListener";
import ConsentLogReconciler from "@/components/legal/ConsentLogReconciler";

// Pages that show the bottom tab bar
const TAB_PAGES = ["/Dashboard", "/Trends", "/Social", "/Settings", "/Badges"];

// Occupies the content area while a page chunk arrives, without moving the
// shell around it. Sized to roughly a screen's worth so the tab bar does
// not jump up to meet a short placeholder and then back down when the real
// page renders taller.
//
// No spinner: at this point the shell is already on screen and the tab bar
// has already changed to show the chosen tab, so the user has feedback
// that their tap registered. A spinner on top of that reads as a second,
// slower thing happening. role="status" keeps it announced for anyone who
// cannot see that the tab changed.
function PageLoadingFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status">
      <span className="sr-only">Loading page…</span>
    </div>
  );
}

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
      {/* The consent decision is made outside the auth gate (the banner is
          mounted in App.jsx so it can gate PostHog on the public landing
          page), so there is no user to key a row to at the moment of
          choosing. This records it server-side the first time they are
          signed in afterwards. */}
      {user?.email && <ConsentLogReconciler userEmail={user.email} />}
      <main className={showTabs ? "pb-[calc(3.75rem_+_env(safe-area-inset-bottom))]" : ""}>
        {/* The page chunks are lazy, so switching tabs suspends. Without a
            boundary HERE the nearest one is the single <Suspense> at the
            top of App.jsx, whose fallback is a `fixed inset-0` full-screen
            spinner -- so every first visit to a tab tore down the entire
            shell, tab bar included, and replaced it with a centred
            spinner. The destination then mounted from scratch. That is
            what made moving between pages feel like relaunching the app.

            Catching it here keeps the chrome mounted and swaps only the
            content area, so the tab bar stays put, stays tappable, and
            keeps showing which tab you chose while its page arrives.

            In practice this fallback is rarely seen at all now: the tab
            chunks are prefetched while the browser is idle (see
            routeModules.js), so by the time a tab is tapped its module is
            usually already in memory and the swap is synchronous. This is
            the honest path for a cold tap that beat the prefetch. */}
        <Suspense fallback={<PageLoadingFallback />}>
          <Outlet />
        </Suspense>
      </main>
      {showTabs && <BottomTabBar unreadReactions={unreadReactions} />}
    </div>
  );
}