import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { format, parseISO, eachDayOfInterval, differenceInDays, isAfter } from "date-fns";
import { Crown, Medal, Flame, Trophy } from "lucide-react";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { cn } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import ChallengeCompleteScreen from "./ChallengeCompleteScreen";
import { ChallengeHabitLink } from "@/api/entities";
import { linkChallengeHabit } from "@/lib/habitLinkService";
import LinkChallengeHabitModal from "./LinkChallengeHabitModal";
import { toast } from "sonner";

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-muted-foreground" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
  return <span className="text-xs font-bold text-muted-foreground w-4 text-center">#{rank}</span>;
}

// elapsedDates/todayStr are computed once at the top of the component and
// passed in here -- shared with the get_challenge_member_progress RPC
// call below, so "me" (computed locally, from real live data) and every
// other member (computed server-side, via the RPC) are always evaluated
// against the exact same date list, with no risk of the two disagreeing
// at a day boundary.
// "me", resolved from the viewer's own link rather than by matching the
// challenge's habit_name against their habit names. The name match is gone
// from every read path; it survives only as a pre-selection in the link
// modal, where it is a suggestion the user can override rather than the
// thing that decides whether their progress counts.
function getStatsForMember(challenge, habits, elapsedDates, myLink) {
  const elapsedDays = elapsedDates.length;

  const linkedHabit = myLink ? habits.find((h) => h.id === myLink.habit_id) : null;

  if (!linkedHabit) {
    // No link at all, or the linked habit is gone from the active list.
    // `habits` here is the viewer's live habits prop; an archived habit is
    // still in it, so the two cases stay distinguishable.
    return { completedDays: 0, pct: 0, streak: 0, elapsedDays, linkState: "not_linked" };
  }

  if (linkedHabit.archived) {
    return { completedDays: 0, pct: 0, streak: 0, elapsedDays, linkState: "archived" };
  }

  const completions = linkedHabit.completions || [];
  const challengeCompletions = completions.filter(
    (d) => d >= challenge.start_date && d <= challenge.end_date
  );

  const completedDays = elapsedDates.filter((d) => completions.includes(d)).length;
  const pct = elapsedDays > 0 ? Math.round((completedDays / elapsedDays) * 100) : 0;
  const streak = calculateStreak(challengeCompletions);

  return { completedDays, pct, streak, elapsedDays, linkState: "linked" };
}

// Same shape as getStatsForMember's return value, sourced from the RPC's
// per-member row instead of a local habits array -- get_challenge_member_
// progress already applies the identical completedDays/streak logic
// server-side (see the migration), this just fills in pct, which is pure
// arithmetic with no data dependency.
function statsFromRpcRow(row, elapsedDates) {
  const elapsedDays = elapsedDates.length;
  // link_state replaced a no_matching_habit boolean, for the reason
  // 20261025090001 had to go and fix in the focus session: a boolean cannot
  // carry three outcomes, and a client handed an ambiguous value guesses.
  // A missing row is treated as not_linked -- the RPC returns one row per
  // roster member, so this only happens if the roster and the result
  // disagree, and claiming progress for a row that is not there would be
  // worse than saying nothing.
  if (!row) {
    return { completedDays: 0, pct: 0, streak: 0, elapsedDays, linkState: "not_linked" };
  }
  if (row.link_state !== "linked") {
    return { completedDays: 0, pct: 0, streak: 0, elapsedDays, linkState: row.link_state };
  }
  const completedDays = row.completed_days;
  const pct = elapsedDays > 0 ? Math.round((completedDays / elapsedDays) * 100) : 0;
  return { completedDays, pct, streak: row.streak, elapsedDays, linkState: "linked" };
}

export default function ChallengeLeaderboard({ challenge, habits: myHabits, userEmail, profiles = [], onStartNew, isAdmin }) {
  const queryClient = useQueryClient();
  const [showLinkModal, setShowLinkModal] = useState(false);
  const startDate = parseISO(challenge.start_date);
  const endDate = parseISO(challenge.end_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isEnded = isAfter(today, endDate);
  const totalDays = challenge.duration_days;
  const daysElapsed = Math.min(differenceInDays(today, startDate) + 1, totalDays);
  const daysRemaining = Math.max(totalDays - daysElapsed, 0);
  const progressPct = Math.round((daysElapsed / totalDays) * 100);

  // The stats-relevant elapsed window -- capped at the challenge's own
  // end_date, not at totalDays like daysElapsed above (that distinction
  // already existed before this fix, preserved as-is).
  const effectiveEnd = isAfter(today, endDate) ? endDate : today;
  const elapsedDayCount = Math.max(differenceInDays(effectiveEnd, startDate) + 1, 0);
  const allDays = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
    format(d, "yyyy-MM-dd")
  );
  const elapsedDates = allDays.slice(0, elapsedDayCount);
  const todayStr = format(today, "yyyy-MM-dd");

  const members = challenge.member_emails || [];
  const otherMembers = members.filter((e) => e !== userEmail);

  // get_challenge_member_progress reads every OTHER member's habits
  // server-side (bypassing habits_select_own's owner-only RLS the same
  // way join_group/send_reaction already do for groups/reactions) -- a
  // plain client fetch can never see another user's habits row at all,
  // which is why every non-"me" row here used to show "No matching
  // habit" regardless of real progress. "me" stays computed locally
  // below, from the live myHabits prop -- same "me is always live-local,
  // others come from the trusted source" pattern as the group
  // leaderboard and weekly-report fixes.
  // The viewer's own link. RLS on challenge_habit_links is select-own, so
  // this returns at most one row and never anyone else's -- every other
  // member's link is resolved inside the RPC below, which is SECURITY
  // DEFINER for exactly that reason.
  const { data: myLinks = [] } = useQuery({
    queryKey: ["challenge-habit-link", challenge.id],
    queryFn: () => ChallengeHabitLink.filter({ challenge_id: challenge.id }),
    staleTime: 30_000,
  });
  const myLink = myLinks[0] || null;

  const linkMutation = useMutation({
    // Annotated because TanStack infers TVariables from mutationFn, and
    // linkChallengeHabit returns void -- without this, habitId in
    // onSuccess is typed `void` and cannot be tested for truthiness.
    mutationFn: (/** @type {string | null} */ habitId) =>
      linkChallengeHabit(challenge.id, habitId),
    onSuccess: (_, habitId) => {
      setShowLinkModal(false);
      queryClient.invalidateQueries({ queryKey: ["challenge-habit-link", challenge.id] });
      // Everyone else's rows come from the RPC, and my own link changes
      // what it reports for me, so that has to refetch too.
      queryClient.invalidateQueries({ queryKey: ["challenge-progress", challenge.id] });
      toast.success(habitId ? "Linked — your check-ins now count." : "Unlinked.", { duration: 2500 });
    },
    onError: (err) => {
      toast.error(err?.message || "Couldn't link that habit. Please try again.", { duration: 3500 });
    },
  });

  const { data: memberProgress = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["challenge-progress", challenge.id, elapsedDates.length, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_challenge_member_progress", {
        p_challenge_id: challenge.id,
        p_elapsed_dates: elapsedDates,
        p_today: todayStr,
      });
      if (error) throw error;
      return data;
    },
    enabled: otherMembers.length > 0,
    staleTime: 30_000,
  });

  const progressByEmail = new Map(memberProgress.map((row) => [row.email, row]));

  // Build rows with real data for everyone. A failed RPC must never look
  // like a teammate who simply hasn't logged the habit -- that ambiguity
  // is exactly what the RLS fix this leaderboard is built on eliminated
  // for the "can't see other members at all" case, so a fetch error gets
  // its own loadError state instead of silently falling through to
  // statsFromRpcRow's not_linked default.
  const rows = members.map((email) => {
    const isMe = email === userEmail;
    const stats = isMe
      ? getStatsForMember(challenge, myHabits, elapsedDates, myLink)
      : isError
        ? { completedDays: 0, pct: 0, streak: 0, elapsedDays: elapsedDates.length, linkState: "linked", loadError: true }
        : statsFromRpcRow(progressByEmail.get(email), elapsedDates);
    return {
      email,
      name: getDisplayName(email, profiles),
      isMe,
      ...stats,
    };
  }).sort((a, b) => b.pct - a.pct || b.streak - a.streak || b.completedDays - a.completedDays);

  const myStats = getStatsForMember(challenge, myHabits, elapsedDates, myLink);
  const myRank = rows.findIndex((r) => r.isMe) + 1;
  const groupCompletionRate = Math.round(rows.reduce((s, r) => s + r.pct, 0) / Math.max(rows.length, 1));

  if (isEnded) {
    return (
      <ChallengeCompleteScreen
        challenge={challenge}
        rows={rows}
        groupCompletionRate={groupCompletionRate}
        isAdmin={isAdmin}
        onStartNew={onStartNew}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Challenge header */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <Trophy className="w-3.5 h-3.5 text-accent" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Challenge</p>
            </div>
            <p className="font-bold text-base text-foreground">{challenge.habit_name}</p>
            <p className="text-xs font-medium text-primary mt-0.5">Tracking: {challenge.habit_name}</p>
            {challenge.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{challenge.description}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-foreground">{daysRemaining}</p>
            <p className="text-[10px] text-muted-foreground">days left</p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Day {daysElapsed} of {totalDays}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* My quick stats */}
        <div className="flex gap-3 pt-1">
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">{myStats.pct}%</p>
            <p className="text-[10px] text-muted-foreground">My completion</p>
          </div>
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">{myStats.streak}</p>
            <p className="text-[10px] text-muted-foreground">Current streak</p>
          </div>
          <div className="flex-1 bg-muted/60 rounded-xl p-2 text-center">
            <p className="text-base font-bold text-foreground">#{myRank}</p>
            <p className="text-[10px] text-muted-foreground">My rank</p>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {challenge.habit_name} · Live Rankings
          </p>
          {isLoading && (
            <span className="text-[10px] text-muted-foreground animate-pulse">Updating…</span>
          )}
        </div>
        {/* This ranks by % of challenge days completed, not the
            Best-Streak×2+Consistency "points" formula the global and
            group leaderboards use -- called out explicitly so the same
            crown/medal chrome doesn't read as the same score everywhere
            it appears. */}
        <p className="text-[11px] text-muted-foreground mb-3">
          Ranked by % of challenge days completed
        </p>

        {isError && (
          <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <span>Couldn't load teammates' progress.</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="font-semibold underline underline-offset-2 shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {rows.map((row, i) => (
          <div key={row.email} className={cn(
            "flex items-center gap-3 p-2 rounded-xl transition-colors",
            row.isMe ? "bg-primary/5 ring-1 ring-primary/20" : i < 3 ? "bg-muted/40" : ""
          )}>
            <div className="w-6 flex items-center justify-center shrink-0">
              <RankIcon rank={i + 1} />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {row.name[0].toUpperCase()}
            </div>
            {row.loadError ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                </p>
                <p className="text-[11px] text-destructive leading-tight">
                  Couldn't load progress
                </p>
              </div>
            ) : row.linkState !== "linked" ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                </p>
                {/* Was "No matching habit. Add \"X\" to join" -- an
                    instruction with no affordance, which also required
                    reproducing a string exactly. Now the viewer's own row
                    carries the action, and nobody can link on anyone
                    else's behalf. */}
                {row.isMe ? (
                  <button
                    type="button"
                    onClick={() => setShowLinkModal(true)}
                    className="h-11 -my-2 text-[11px] font-semibold text-primary leading-tight rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {row.linkState === "archived"
                      ? "Your linked habit is archived \u2014 pick another"
                      : "Pick which habit counts"}
                  </button>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {row.linkState === "archived" ? "Their linked habit is archived" : "Hasn't picked a habit yet"}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${row.pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{row.pct}%</span>
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="flex items-center gap-1 justify-end">
                    <Flame className="w-3 h-3 text-accent" />
                    <span className="text-xs font-bold">{row.streak}d</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{row.completedDays}/{row.elapsedDays} days</p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Only mounted on the live view. An ended challenge cannot be
          linked -- link_challenge_habit refuses one whose end_date has
          passed, because progress is then historical and a member should
          not be able to rewrite a finished leaderboard. */}
      <LinkChallengeHabitModal
        open={showLinkModal}
        onOpenChange={setShowLinkModal}
        habitName={challenge.habit_name}
        habits={myHabits}
        currentHabitId={myLink?.habit_id || null}
        saving={linkMutation.isPending}
        onSave={(habitId) => linkMutation.mutate(habitId)}
      />
    </div>
  );
}

export { getStatsForMember as getChallengeStats };
