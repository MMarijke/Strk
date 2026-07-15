import React, { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GroupChallenge, Group } from "@/api/entities";
import { format, parseISO, differenceInDays, isAfter } from "date-fns";
import { Trophy, Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { getChallengeStats } from "@/components/groups/ChallengeLeaderboard";

export default function ChallengeBanner({ userEmail, habits }) {
  const queryClient = useQueryClient();
  const cleanupRan = useRef(false);

  const { data: challenges = [] } = useQuery({
    queryKey: ["group-challenges"],
    queryFn: () => GroupChallenge.list("-created_date"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: () => Group.list("-created_date"),
    staleTime: 5 * 60 * 1000,
  });

  // One-time orphan cleanup: delete challenges whose group no longer exists
  useEffect(() => {
    if (cleanupRan.current || !challenges.length || !groups.length) return;
    cleanupRan.current = true;

    const groupIds = new Set(groups.map((g) => g.id));
    const orphans = challenges.filter((c) => !groupIds.has(c.group_id));
    if (!orphans.length) return;

    Promise.all(orphans.map((c) => GroupChallenge.delete(c.id))).then(() => {
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
    });
  }, [challenges, groups, queryClient]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupIds = new Set(groups.map((g) => g.id));
  const myGroupEmails = new Set(
    groups
      .filter((g) => (g.member_emails || []).includes(userEmail) || g.created_by === userEmail)
      .map((g) => g.id)
  );

  // Only show challenges where:
  // 1. The group still exists
  // 2. The user is still a member
  // 3. The challenge is active and within its date range
  const activeChallenges = challenges.filter((c) => {
    if (!c.is_active) return false;
    if (!groupIds.has(c.group_id)) return false;
    if (!myGroupEmails.has(c.group_id)) return false;
    const end = parseISO(c.end_date);
    const start = parseISO(c.start_date);
    return !isAfter(start, today) && !isAfter(today, end) &&
      (c.member_emails || []).includes(userEmail);
  });

  if (!activeChallenges.length) return null;

  const challenge = activeChallenges[0];
  const endDate = parseISO(challenge.end_date);
  const daysRemaining = differenceInDays(endDate, today) + 1;

  const myStats = getChallengeStats(challenge, habits, userEmail);
  const members = challenge.member_emails || [];
  const rows = members.map((email) => {
    if (email === userEmail) return { email, pct: myStats.pct, streak: myStats.streak };
    return { email, pct: 0, streak: 0 };
  }).sort((a, b) => b.pct - a.pct || b.streak - a.streak);
  const myRank = rows.findIndex((r) => r.email === userEmail) + 1;

  return (
    <Link to="/Social">
      <div className="rounded-xl bg-gradient-to-r from-accent/10 to-primary/10 border border-accent/20 px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
          <Trophy className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground truncate">{challenge.habit_name}</p>
          <p className="text-[11px] text-muted-foreground">{daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining · Rank #{myRank}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Flame className="w-3.5 h-3.5 text-accent" />
          <span className="text-sm font-bold text-foreground">{myStats.pct}%</span>
        </div>
      </div>
    </Link>
  );
}