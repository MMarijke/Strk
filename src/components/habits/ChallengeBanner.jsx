import React, { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GroupChallenge, Group } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { format, parseISO, eachDayOfInterval, differenceInDays, isAfter } from "date-fns";
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

  // challenge/elapsedDates/the RPC query below are all computed
  // unconditionally, ahead of the `if (!activeChallenges.length) return
  // null` below -- Hooks must be called in the same order on every
  // render, so the useQuery call can't move after that early return;
  // instead it's always called, just disabled (enabled: false) when
  // there's no active challenge.
  const challenge = activeChallenges[0] || null;
  const startDate = challenge ? parseISO(challenge.start_date) : null;
  const endDate = challenge ? parseISO(challenge.end_date) : null;

  // Mirrors ChallengeLeaderboard.jsx's own elapsedDates computation --
  // getChallengeStats (aka getStatsForMember) requires this instead of
  // the userEmail this call site used to pass, which the function never
  // actually read.
  const effectiveEnd = challenge && isAfter(today, endDate) ? endDate : today;
  const elapsedDayCount = challenge ? Math.max(differenceInDays(effectiveEnd, startDate) + 1, 0) : 0;
  const allDays = challenge
    ? eachDayOfInterval({ start: startDate, end: endDate }).map((d) => format(d, "yyyy-MM-dd"))
    : [];
  const elapsedDates = allDays.slice(0, elapsedDayCount);
  const todayStr = format(today, "yyyy-MM-dd");

  const members = challenge?.member_emails || [];
  const otherMembers = members.filter((e) => e !== userEmail);

  // get_challenge_member_progress reads every OTHER member's habits
  // server-side (bypassing habits_select_own's owner-only RLS the same
  // way join_group/send_reaction already do) -- a plain client fetch can
  // never see another user's habits row at all. "me" stays computed
  // locally below, from the live habits prop. Same queryKey shape as
  // ChallengeLeaderboard.jsx's identical call, so the two share a cache
  // entry (and one network request) when the same challenge is open in
  // both places on the same day.
  const { data: memberProgress = [] } = useQuery({
    queryKey: ["challenge-progress", challenge?.id, elapsedDates.length, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_challenge_member_progress", {
        p_challenge_id: challenge.id,
        p_elapsed_dates: elapsedDates,
        p_today: todayStr,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!challenge && otherMembers.length > 0,
    staleTime: 30_000,
  });

  if (!activeChallenges.length) return null;

  const daysRemaining = differenceInDays(endDate, today) + 1;
  const myStats = getChallengeStats(challenge, habits, elapsedDates);

  const progressByEmail = new Map(memberProgress.map((row) => [row.email, row]));
  const rows = members.map((email) => {
    if (email === userEmail) return { email, pct: myStats.pct, streak: myStats.streak };
    const row = progressByEmail.get(email);
    if (!row || row.no_matching_habit) return { email, pct: 0, streak: 0 };
    const pct = elapsedDates.length > 0 ? Math.round((row.completed_days / elapsedDates.length) * 100) : 0;
    return { email, pct, streak: row.streak };
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
