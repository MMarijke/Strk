import { FocusSession, FocusSessionNotification } from "@/api/entities";
import { addMinutes, formatISO } from "date-fns";
import { trackEvent } from "@/lib/analytics";

// The one place a focus session gets created.
//
// Extracted from StartFocusModal when GroupDashboard gained its own
// "Sit with us now" button. Two creation paths for the same row is the bug
// class that already produced two member-removal flows in this codebase
// with different confirmation copy, different error handling and different
// touch targets -- one of them silently discarding its promise. Refusing
// that on the first day is cheaper than reconciling it later.

// How long the lobby runs before the timer starts. The authoritative
// deadline is always the lobby_ends_at this function writes; SessionRoom
// measures the ring from created_at -> lobby_ends_at rather than from a
// second copy of this number.
export const LOBBY_MINUTES = 2;

// Default length for a one-tap start. The group screen deliberately does
// not ask: the lobby is where you find out who is coming, and 25 is both
// the existing default and the shortest option, so a one-tap session is
// the smallest commitment available.
export const DEFAULT_DURATION_MINUTES = 25;

function generateSessionCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Creates a focus session and, when it belongs to a group, notifies that
 * group's other members.
 *
 * Returns the created session. Notification delivery is fire-and-forget on
 * purpose -- the host must land in their own lobby without waiting on a
 * batch insert to other people's rows, and a failed notify must not read
 * as a failed session. Rejections from the create itself DO propagate, so
 * every caller is obliged to handle them.
 */
export async function startFocusSession({
  userEmail,
  userName,
  group = null,
  durationMinutes = DEFAULT_DURATION_MINUTES,
}) {
  const session = await FocusSession.create({
    host_email: userEmail,
    host_name: userName,
    group_id: group?.id || undefined,
    duration_minutes: durationMinutes,
    // started_at/ends_at are intentionally left unset -- start_focus_session_now()
    // sets them when the lobby actually ends, so the focus timer counts from
    // when it truly begins rather than from session creation.
    lobby_ends_at: formatISO(addMinutes(new Date(), LOBBY_MINUTES)),
    status: "waiting",
    participant_emails: [userEmail],
    session_code: generateSessionCode(),
  });

  trackEvent("focus_session_started");

  // No group means nobody to tell -- a code-only session is invited by
  // sharing the code, which SessionRoom handles.
  const otherMembers = (group?.member_emails || []).filter((e) => e !== userEmail);
  if (otherMembers.length > 0) {
    FocusSessionNotification.createMany(
      otherMembers.map((email) => ({
        session_id: session.id,
        session_code: session.session_code,
        group_id: group.id,
        group_name: group.name,
        host_email: userEmail,
        host_name: userName,
        duration_minutes: durationMinutes,
        lobby_ends_at: session.lobby_ends_at,
        recipient_email: email,
        dismissed: false,
      }))
    ).catch((err) => console.warn("Failed to notify group of focus session:", err));
  }

  return session;
}
