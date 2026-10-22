import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountabilityNudge, UserProfile } from "@/api/entities";
import { getDisplayName } from "@/lib/displayName";

// Global counterpart to the listener that used to live inside Social.jsx.
//
// Mounted once app-wide from AppLayout.jsx, for the same reason
// FocusInviteListener is: a nudge used to be delivered if and only if the
// recipient happened to be sitting on /Social at the moment it was sent.
// Anywhere else in the app -- or backgrounded, or offline -- and it was
// destroyed, while the sender was told "Nudge sent!" and then rate-limited
// out of trying again for 24 hours.
//
// Two halves to fixing that, and both are needed:
//   * mounted globally, so a live nudge reaches whoever is on whatever page;
//   * and backed by the row's new `read` flag (20261022090001), so one that
//     arrives while the app is closed is still waiting next time it opens
//     rather than having been thrown away.
//
// A nudge is deliberately not an inbox. It is an acknowledgement-free poke,
// so being *shown* is what delivery means -- the toast marks it read, which
// is also what stops it reappearing on every navigation and remount. What
// this guarantees is that it survives until the app is open and looked at;
// it does not guarantee somebody was watching the screen, and no toast can.
export default function AccountabilityNudgeListener({ userEmail }) {
  const queryClient = useQueryClient();
  const shownNudgeIds = useRef(new Set());

  // Profiles only so a nudge can name the sender the way the rest of the app
  // does. Same query key and staleTime as Social.jsx, so this shares that
  // cache entry rather than adding a fetch on every page.
  const { data: profiles = [] } = useQuery({
    queryKey: ["user-profiles"],
    queryFn: () => UserProfile.list("-best_streak"),
    staleTime: 5 * 60 * 1000,
    enabled: !!userEmail,
  });

  // The nudges this user was sent and has not been shown yet. The entity
  // shim's filter only does equality, so `read` is filtered client-side --
  // the same shape AppLayout already uses to count unread reactions.
  const { data: nudges = [] } = useQuery({
    queryKey: ["accountability-nudges-unread", userEmail],
    queryFn: () => userEmail
      ? AccountabilityNudge.filter({ recipient_email: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail,
  });

  const show = (nudge) => {
    if (!nudge || shownNudgeIds.current.has(nudge.id)) return;
    shownNudgeIds.current.add(nudge.id);

    const senderName = getDisplayName(nudge.sender_email, profiles);
    toast(`👋 ${senderName} nudged you to keep your streak going!`, {
      id: nudge.id,
      duration: 6000,
      dismissible: true,
    });

    // Fire-and-forget: a failed write means the nudge shows once more on the
    // next open, which is a far better failure than blocking the toast on a
    // round-trip. The in-memory Set stops it repeating within this session
    // regardless.
    AccountabilityNudge.update(nudge.id, { read: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["accountability-nudges-unread", userEmail] });
      })
      .catch((err) => console.error("Failed to mark nudge read:", err));
  };

  // Anything missed while the app was closed. Oldest first, so a backlog
  // reads in the order it happened.
  useEffect(() => {
    if (!userEmail) return;
    [...nudges]
      .filter((n) => !n.read)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .forEach(show);
    // `show` is recreated each render and is deliberately not a dependency:
    // the ref guard makes a repeat call a no-op, and depending on it would
    // re-run this on every profiles change for no benefit.
  }, [nudges, userEmail]);

  // And anything arriving right now.
  useEffect(() => {
    if (!userEmail) return;
    const unsubscribe = AccountabilityNudge.subscribe((event) => {
      if (event.type !== "create") return;
      if (event.data.recipient_email !== userEmail) return;
      show(event.data);
    });
    return unsubscribe;
  }, [userEmail]);

  return null;
}
