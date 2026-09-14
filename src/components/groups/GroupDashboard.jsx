import React, { useState } from "react";
import { Reaction, Habit, GroupChallenge, ChallengeNotification } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays, parseISO, isAfter } from "date-fns";
import { Crown, Medal, Flame, ArrowLeft, Copy, Check, Share2, UserMinus, Settings, Trophy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { getAllTimeBest } from "@/components/habits/MilestoneBadges";
import CreateChallengeModal from "./CreateChallengeModal";
import InviteMembersSheet from "./InviteMembersSheet";
import ChallengeLeaderboard from "./ChallengeLeaderboard";
import ReactionButton from "./ReactionButton";
import GroupWeeklyReport from "./GroupWeeklyReport";
import GroupSettingsModal from "./GroupSettingsModal";
import { getDisplayName } from "@/lib/displayName";
import { getRank } from "@/lib/utils";
import { toast } from "sonner";
import { format as fmtDate } from "date-fns";
import { trackEvent } from "@/lib/analytics";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/api/supabaseClient";

const CATEGORY_LABELS = {
  health: "Health", fitness: "Fitness", mindfulness: "Mindfulness",
  learning: "Learning", productivity: "Productivity", social: "Social", other: "Other",
};

function calcConsistency(completions) {
  if (!completions?.length) return 0;
  const last30 = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
  return Math.round((last30.filter((d) => completions.includes(d)).length / 30) * 100);
}

function calcScore(habits) {
  // All-time best streak, not calculateStreak()'s "current active streak"
  // -- matches what the habits_sync_profile_stats trigger computes into
  // user_profiles.best_streak (and what Social.jsx's leaderboard tab
  // already expects), so "me" and other members are scored on the same
  // definition instead of two different metrics under the same label.
  const bestStreak = habits.reduce((m, h) => Math.max(m, getAllTimeBest(h.completions || [])), 0);
  const consistency = habits.length
    ? Math.round(habits.reduce((s, h) => s + calcConsistency(h.completions || []), 0) / habits.length)
    : 0;
  return { score: bestStreak * 2 + consistency, bestStreak, consistency };
}

function getTopHabit(habits) {
  if (!habits.length) return null;
  return habits.reduce((best, h) => {
    const s = calculateStreak(h.completions || []);
    return s > (best ? calculateStreak(best.completions || []) : -1) ? h : best;
  }, null);
}

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-muted-foreground" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
  return <span className="text-xs font-bold text-muted-foreground w-4 text-center">#{rank}</span>;
}

function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function getInviteLink(code) {
  return `${window.location.origin}?join=${code}`;
}

export default function GroupDashboard({ group, userId, userEmail, userFullName, profiles = [], onBack, onUpdate, onDelete, onRemoveMember }) {
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [viewingChallenge, setViewingChallenge] = useState(false);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [newName, setNewName] = useState(group.name);

  const queryClient = useQueryClient();
  const { isPro } = useSubscription();
  // created_by_id (uuid, RLS-authoritative) not created_by (email) -- the
  // latter is a denormalized display column that was backfilled with the
  // migration-runner's own session (no end-user JWT) for every group that
  // existed before it was added, so it's wrong for pre-migration groups
  // and silently hides the real owner's admin controls (including Delete).
  const isAdmin = group.created_by_id === userId;
  const memberEmails = group.member_emails || [];

  const todayStr = fmtDate(new Date(), "yyyy-MM-dd");

  const { data: reactionsReceived = [] } = useQuery({
    queryKey: ["reactions", userEmail],
    queryFn: () => userEmail
      ? Reaction.filter({ recipient_email: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail,
  });

  const { data: reactionsSentTodayData = [] } = useQuery({
    queryKey: ["reactions-sent", userEmail, todayStr],
    queryFn: () => userEmail
      ? Reaction.filter({ sender_email: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail,
  });

  const reactionsReceivedToday = reactionsReceived.filter(
    (r) => r.created_date?.slice(0, 10) === todayStr
  );
  const reactionsSentToday = reactionsSentTodayData.filter(
    (r) => r.created_date?.slice(0, 10) === todayStr
  ).length;

  const { data: habits = [] } = useQuery({
    queryKey: ["habits", userEmail],
    queryFn: () => userEmail
      ? Habit.filter({ created_by: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail,
    // Matches Dashboard.jsx/Social.jsx's staleTime on this same query key
    // -- see Social.jsx's comment on its own habits query for why.
    staleTime: 5 * 60 * 1000,
  });

  const { data: challenges = [] } = useQuery({
    queryKey: ["group-challenges", group.id],
    queryFn: () => GroupChallenge.filter(
      { group_id: group.id },
      "-created_date"
    ),
    enabled: !!group.id,
  });

  const createChallengeMutation = useMutation({
    mutationFn: (data) => GroupChallenge.create(data),
    // habit_name now comes from newChallenge (the inserted row, with the
    // group_challenges_set_habit_name trigger's server-derived value),
    // not vars (the client-submitted payload) -- the client no longer
    // sends habit_name at all now that habit selection is habit_id-based.
    onSuccess: async (newChallenge, vars) => {
      trackEvent("challenge_started");
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
      queryClient.invalidateQueries({ queryKey: ["challenge-notifications"] });

      // Fire a ChallengeNotification for every member except the admin who
      // started it -- one batched insert instead of N separate .create()
      // calls, since these are naturally one write (same challenge, same
      // starter, only recipient_email varies per row).
      const otherMembers = (group.member_emails || []).filter((e) => e !== userEmail);
      const adminName = getDisplayName(userEmail, profiles) || userFullName || userEmail.split("@")[0];
      await ChallengeNotification.createMany(
        otherMembers.map((email) => ({
          challenge_id: newChallenge.id,
          group_id: group.id,
          group_name: group.name,
          habit_name: newChallenge.habit_name,
          duration_days: vars.duration_days,
          started_by_email: userEmail,
          started_by_name: adminName,
          recipient_email: email,
          dismissed: false,
        }))
      );

      // Show a 5s toast for the admin with details and a "View Challenge" action
      toast(
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏆</span>
            <div>
              <p className="font-semibold text-sm text-foreground leading-tight">Challenge launched!</p>
              <p className="text-xs text-muted-foreground">{newChallenge.habit_name} · {vars.duration_days} days · {group.name}</p>
            </div>
          </div>
          <button
            className="w-full rounded-lg bg-primary text-primary-foreground text-xs font-semibold py-1.5 hover:bg-primary/90 transition-colors"
            onClick={() => setViewingChallenge(true)}
          >
            View Challenge →
          </button>
        </div>,
        { duration: 5000, dismissible: true }
      );

      setViewingChallenge(true);
    },
  });

  const createReactionMutation = useMutation({
    // send_reaction enforces the daily limit (Pro-aware) and group
    // membership server-side, and derives sender_email/sender_name itself
    // -- see 20260811090005. The old direct Reaction.create(data) path is
    // gone; reactions_insert_as_sender was retired in the same migration,
    // so this RPC is now the only way to insert a reaction at all.
    mutationFn: ({ recipient_email, emoji, group_id }) =>
      supabase.rpc("send_reaction", {
        p_recipient_email: recipient_email,
        p_emoji: emoji,
        p_group_id: group_id,
      }).then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["reactions", userEmail] });
      queryClient.invalidateQueries({ queryKey: ["reactions-sent", userEmail] });
      toast.success(`Reaction sent! ${vars.emoji}`, { duration: 2000 });
    },
    onError: (error) => {
      if (error?.message?.includes("DAILY_LIMIT_REACHED")) {
        toast.error("You've used all 3 reactions today. Upgrade to Pro for unlimited.", { duration: 3000 });
      } else {
        toast.error("Couldn't send that reaction. Please try again.", { duration: 3000 });
      }
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupChallenges = challenges;
  const activeChallenge = groupChallenges.find((c) => {
    if (!c.is_active) return false;
    const end = parseISO(c.end_date);
    const start = parseISO(c.start_date);
    return !isAfter(start, today) && !isAfter(today, end);
  });

  const myStats = calcScore(habits);
  const myTopHabit = getTopHabit(habits);

  const rows = memberEmails.map((email) => {
    const name = email === userEmail
      ? (getDisplayName(email, profiles) !== email.split("@")[0] ? getDisplayName(email, profiles) : (userFullName || getDisplayName(email, profiles)))
      : getDisplayName(email, profiles);
    if (email === userEmail) {
      return { email, name, isMe: true, ...myStats, topHabit: myTopHabit, hasData: true };
    }
    const memberProfile = profiles.find((p) => p.created_by === email);
    if (!memberProfile) {
      // Private profile (is_public = false, invisible under RLS) or no
      // synced stats yet -- an honest "no data" state, not a real 0.
      // Showing a bare 0 here was the bug: indistinguishable from a
      // genuine score of zero.
      return { email, name, isMe: false, score: null, bestStreak: 0, consistency: 0, topHabit: null, hasData: false };
    }
    return {
      email,
      name,
      isMe: false,
      score: (memberProfile.best_streak || 0) * 2 + (memberProfile.consistency_score || 0),
      bestStreak: memberProfile.best_streak || 0,
      consistency: memberProfile.consistency_score || 0,
      topHabit: null,
      hasData: true,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const categoryCount = {};
  habits.forEach((h) => {
    if (h.category) categoryCount[h.category] = (categoryCount[h.category] || 0) + 1;
  });

  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRegenerateCode = () => {
    const code = generateInviteCode();
    onUpdate({ invite_code: code });
  };

  const handleRename = () => {
    if (newName.trim() && newName.trim() !== group.name) {
      onUpdate({ name: newName.trim() });
    }
  };

  const inviteLink = getInviteLink(group.invite_code || "--------");

  // Weekly report view
  if (showWeeklyReport) {
    return (
      <GroupWeeklyReport
        group={group}
        habits={habits}
        userEmail={userEmail}
        challenges={challenges}
        profiles={profiles}
        onBack={() => setShowWeeklyReport(false)}
      />
    );
  }

  // Challenge view
  if (viewingChallenge && (activeChallenge || groupChallenges.length > 0)) {
    const challenge = activeChallenge || groupChallenges[0];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setViewingChallenge(false)} aria-label="Back to group">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="font-bold text-base">{group.name}</h2>
            <p className="text-xs text-muted-foreground">Challenge</p>
          </div>
        </div>
        <ChallengeLeaderboard
          challenge={challenge}
          habits={habits}
          userEmail={userEmail}
          profiles={profiles}
          isAdmin={isAdmin}
          onStartNew={() => { setViewingChallenge(false); setShowCreateChallenge(true); }}
        />
        <CreateChallengeModal
          open={showCreateChallenge}
          onOpenChange={setShowCreateChallenge}
          group={group}
          userHabits={habits}
          onCreate={(data) => createChallengeMutation.mutateAsync(data)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={onBack} aria-label="Back to groups">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-lg truncate">{group.name}</h2>
          <p className="text-xs text-muted-foreground">{memberEmails.length} member{memberEmails.length !== 1 ? "s" : ""}</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowSettings(true)} aria-label="Group settings">
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Invite Members Button */}
      <Button
        variant="outline"
        className="w-full gap-2 rounded-xl h-11 border-primary/30 text-primary hover:bg-primary/5"
        onClick={() => setShowInvite(true)}
      >
        <Share2 className="w-4 h-4" />
        Invite Members
      </Button>

      {/* Admin panel */}
      {!isAdmin && group.invite_code && (
        <div className="flex items-center gap-2 bg-muted/60 rounded-xl px-3 py-2">
          <span className="text-xs text-muted-foreground flex-1 font-mono truncate">{group.invite_code}</span>
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => handleCopy(group.invite_code, "code")} aria-label={copied === "code" ? "Copied!" : "Copy invite code"}>
            {copied === "code" ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
      )}

      {/* Leaderboard */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leaderboard</p>
        {/* Same formula, same caption, as the global Leaderboard tab in
            Social.jsx -- "pts" without this was one of three differently
            -defined "leaderboard" scores in the app sharing identical
            crown/medal chrome, with no way to tell them apart. */}
        <p className="text-[11px] text-muted-foreground mb-3">
          Score = Best Streak × 2 + Consistency %
        </p>
        {rows.map((row, i) => (
          <div key={row.email} className={cn(
            "flex items-center gap-3 p-2 rounded-xl",
            row.isMe ? "bg-primary/5 ring-1 ring-primary/20" : i < 3 ? "bg-muted/50" : ""
          )}>
            <div className="w-6 flex items-center justify-center shrink-0">
              <RankIcon rank={i + 1} />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {row.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {row.hasData && <span className="mr-1">{getRank(row.score).emoji}</span>}
                {row.name} {row.isMe && <span className="text-xs text-primary font-normal">(you)</span>}
              </p>
              {row.topHabit ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Flame className="w-3 h-3 text-accent" />
                  {row.topHabit.name} · {calculateStreak(row.topHabit.completions || [])}d streak
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No habit data visible</p>
              )}
            </div>
            <div className="text-right shrink-0">
              {row.hasData ? (
                <>
                  <p className="text-sm font-bold">{row.score}</p>
                  <p className="text-[10px] text-muted-foreground">pts</p>
                </>
              ) : (
                <p className="text-[10px] text-muted-foreground italic leading-tight max-w-[60px]">No data visible</p>
              )}
            </div>
            {row.isMe ? (
              reactionsReceivedToday.length > 0 && (
                <div className="flex flex-wrap gap-0.5 shrink-0 max-w-[60px]">
                  {Object.entries(
                    reactionsReceivedToday.reduce((acc, r) => {
                      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                      return acc;
                    }, {})
                  ).map(([emoji, count]) => (
                    <span key={emoji} className="text-xs bg-muted rounded-full px-1.5 py-0.5 whitespace-nowrap">
                      {emoji}×{count}
                    </span>
                  ))}
                </div>
              )
            ) : (
              <ReactionButton
                recipientEmail={row.email}
                groupId={group.id}
                sentTodayCount={reactionsSentToday}
                isPro={isPro}
                onSend={(data) => createReactionMutation.mutateAsync(data)}
              />
            )}
            {isAdmin && !row.isMe && (
              confirmRemove === row.email ? (
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="destructive" className="h-7 text-xs"
                    onClick={() => { onRemoveMember(row.email); setConfirmRemove(null); }}>
                    Remove
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRemove(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="icon" variant="ghost" className="h-11 w-11 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setConfirmRemove(row.email)} aria-label={`Remove ${row.email} from group`}>
                  <UserMinus className="w-3.5 h-3.5" />
                </Button>
              )
            )}
          </div>
        ))}
      </div>

      {/* Habits being tracked */}
      {Object.keys(categoryCount).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Habits being tracked</p>
          {Object.entries(categoryCount).map(([cat, count]) => (
            <div key={cat} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{CATEGORY_LABELS[cat] || cat}</span>
              <span className="font-medium">{count} member{count !== 1 ? "s" : ""} tracking</span>
            </div>
          ))}
        </div>
      )}

      {/* Last week's report */}
      <Button
        variant="outline"
        className="w-full gap-2 rounded-xl"
        onClick={() => setShowWeeklyReport(true)}
      >
        📊 Last week's report
      </Button>

      {/* Group Challenge */}
      {activeChallenge ? (
        <button
          onClick={() => setViewingChallenge(true)}
          className="w-full rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 to-primary/10 p-4 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-accent" />
              <div>
                <p className="text-sm font-semibold text-foreground">{activeChallenge.habit_name}</p>
                <p className="text-xs text-muted-foreground">Active challenge · tap to view</p>
              </div>
            </div>
            <span className="text-xs bg-accent/20 text-accent font-semibold px-2 py-0.5 rounded-full">Live</span>
          </div>
        </button>
      ) : isAdmin ? (
        <Button
          variant="outline"
          className="w-full gap-2 rounded-xl border-dashed h-auto py-3 flex-wrap"
          onClick={() => setShowCreateChallenge(true)}
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Start a Group Challenge</span>
        </Button>
      ) : null}

      <CreateChallengeModal
        open={showCreateChallenge}
        onOpenChange={setShowCreateChallenge}
        group={group}
        userHabits={habits}
        onCreate={(data) => createChallengeMutation.mutateAsync(data)}
      />

      <InviteMembersSheet
        open={showInvite}
        onOpenChange={setShowInvite}
        group={group}
      />

      <GroupSettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        group={group}
        isAdmin={isAdmin}
        userEmail={userEmail}
        profiles={profiles}
        activeChallenge={activeChallenge}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onRemoveMember={onRemoveMember}
      />
    </div>
  );
}