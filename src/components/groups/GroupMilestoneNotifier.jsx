import { useEffect, useRef } from "react";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { showNotification } from "@/lib/showNotification";

const MILESTONES = [7, 30, 100];

function checkPermission() {
  return "Notification" in window && Notification.permission === "granted";
}

export default function GroupMilestoneNotifier({ groups, habits, userEmail }) {
  const sentRef = useRef(new Set());

  useEffect(() => {
    if (!checkPermission() || !groups.length || !habits.length) return;

    // Only care about groups the user is in
    const myGroups = groups.filter(
      (g) => g.created_by === userEmail || (g.member_emails || []).includes(userEmail)
    );
    if (!myGroups.length) return;

    // Check our own habits for milestones to notify group members
    // (In a real app you'd push to all members; here we notify locally)
    habits.forEach((habit) => {
      const streak = calculateStreak(habit.completions || []);
      MILESTONES.forEach((milestone) => {
        const key = `${habit.id}-${milestone}`;
        if (streak === milestone && !sentRef.current.has(key)) {
          sentRef.current.add(key);
          // Notify for each group the user is in. showNotification() never
          // throws (see src/lib/showNotification.js) -- a failure notifying
          // one group must not stop the rest of this loop from firing, the
          // way a direct `new Notification(...)` throwing used to.
          myGroups.forEach((group) => {
            const name = userEmail.split("@")[0];
            showNotification(`${name} just hit a ${milestone}-day streak on ${habit.name} 🔥`, {
              body: `Amazing work in ${group.name}! Keep it going!`,
              icon: "/favicon.ico",
              data: { url: `${window.location.origin}/Social` },
            });
          });
        }
      });
    });
  }, [habits, groups, userEmail]);

  return null;
}