import React, { useState } from "react";
import { Reaction, Habit, GroupChallenge, ChallengeNotification } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays, parseISO, isAfter } from "date-fns";
import { Crown, Medal, Flame, ArrowLeft, Copy, Check, Share2, Trash2, UserMinus, Settings, Trophy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { calculateStreak } from "@/components/habits/StreakWidget";
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
  const bestStreak = habits.reduce((m, h) => Math.max(m, calculateStreak(h.completions || [])), 0);
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

export default function GroupDashboard({ group, userEmail, userFullName, profiles = [], onBack, onUpdate, onDelete, onRemoveMember }) {
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [viewingChallenge, setViewingChallenge] = useState(false);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [newName, setNewName] = useState(group.name);

  const queryClient = useQueryClient();
  const isAdmin = group.created_by === userEmail;
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
    onSuccess: async (newChallenge, vars) => {
      trackEvent("challenge_started");
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
      queryClient.invalidateQueries({ queryKey: ["challenge-notifications"] });

      // Fire a ChallengeNotification for every member except the admin who started it
      const otherMembers = (group.member_emails || []).filter((e) => e !== userEmail);
      const adminName = getDisplayName(userEmail, profiles) || userFullName || userEmail.split("@")[0];
      await Promise.all(
        otherMembers.map((email) =>
          ChallengeNotification.create({
            challenge_id: newChallenge.id,
            group_id: group.id,
            group_name: group.name,
            habit_name: vars.habit_name,
            duration_days: vars.duration_days,
            started_by_email: userEmail,
            started_by_name: adminName,
            recipient_email: email,
            dismissed: false,
          })
        )
      );

      // Show a 5s toast for the admin with details and a "View Challenge" action
      toast(
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏆</span>
            <div>
              <p className="font-semibold text-sm text-foreground leading-tight">Challenge launched!</p>
              <p className="text-xs text-muted-foreground">{vars.habit_name} · {vars.duration_days} days · {group.name}</p>
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
    mutationFn: ({ _recipientName, ...data }) => Reaction.create(data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["reactions", userEmail] });
      queryClient.invalidateQueries({ queryKey: ["reactions-sent", userEmail] });
      toast.success(`Reaction sent! ${vars.emoji}`, { duration: 2000 });
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
      return { email, name, isMe: true, ...myStats, topHabit: myTopHabit };
    }
    return { email, name, isMe: false, score: 0, bestStreak: 0, consistency: 0, topHabit: null };
  }).sort((a, b) => b.score - a.score);

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
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setViewingChallenge(false)}>
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
        <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-lg truncate">{group.name}</h2>
          <p className="text-xs text-muted-foreground">{memberEmails.length} member{memberEmails.length !== 1 ? "s" : ""}</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowSettings(true)}>
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(group.invite_code, "code")}>
            {copied === "code" ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
      )}

      {/* Leaderboard */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Leaderboard</p>
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
                <span className="mr-1">{getRank(row.score).emoji}</span>
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
              <p className="text-sm font-bold">{row.score}</p>
              <p className="text-[10px] text-muted-foreground">pts</p>
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
                senderEmail={userEmail}
                senderName={getDisplayName(userEmail, profiles)}
                recipientEmail={row.email}
                recipientName={row.name}
                groupId={group.id}
                sentTodayCount={reactionsSentToday}
                onSend={(data) => createReactionMutation.mutate({ ...data, _recipientName: row.name })}
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
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setConfirmRemove(row.email)}>
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