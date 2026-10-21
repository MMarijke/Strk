import React, { useState } from "react";
import { Reaction, Habit, GroupChallenge, ChallengeNotification } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays, parseISO, isAfter, differenceInCalendarDays } from "date-fns";
import { Crown, Medal, Flame, ArrowLeft, Copy, Check, Share2, Settings, Trophy, Plus, Sparkles, Users } from "lucide-react";
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
import FreezeAssistConfirmModal from "./FreezeAssistConfirmModal";
import UpgradeModal from "@/components/upgrade/UpgradeModal";
import { getDisplayName } from "@/lib/displayName";
import { getRank, assignCompetitionRanks, ordinal } from "@/lib/utils";
import { toast } from "sonner";
import { format as fmtDate } from "date-fns";
import { trackEvent } from "@/lib/analytics";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/api/supabaseClient";
import { getGroupFreezeCandidates, assistFreeze } from "@/lib/freezeService";
import { startFocusSession, DEFAULT_DURATION_MINUTES } from "@/lib/focusSessionStart";
import GroupActivityFeed from "./GroupActivityFeed";

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

// What the line under a teammate's name can honestly say. Their habit
// names and their habit count are unreadable by design -- habits_select_own
// is strictly owner-only with no group-membership exception -- so this slot
// can never show "their top habit" the way it does for you. The one thing
// user_profiles can report about someone else is recency: whether they are
// still completing habits at all. See migration 20261020090001 for the
// column, why it's a date rather than a timestamp, and why "completed" is
// the accurate verb here ("active" would be wrong -- opening the app,
// joining a focus session or reacting to a friend writes no completion).
//
// "Completed" with no object, and never the word "completions": the object
// is already supplied by the surrounding leaderboard, and `completions` is
// a database column name, not a word this product says to users. The app's
// own verb for finishing a habit is Complete (Dashboard's "Complete All",
// HabitCard's check), so every branch below is built from that one verb
// rather than alternating between "Completed a habit" and "Last completed".
//
// These strings are also kept short deliberately. This line sits in the
// row's only flexible column, between a fixed rank+avatar cluster and a
// fixed score+reaction cluster, and it truncates: at 375px it has roughly
// twenty characters before an ellipsis eats the meaning. A longer, more
// explicit phrasing here does not read as more informative, it reads as
// cut off.
function describeMemberActivity(lastCompletionDate) {
  if (!lastCompletionDate) return "No habits completed yet";
  const day = parseISO(lastCompletionDate);
  // Clamped at 0: the column is written from the database's current_date
  // (UTC) while this runs in the viewer's own timezone, so "today" can
  // read as -1 day either side of midnight. Never render a future day.
  const daysAgo = Math.max(0, differenceInCalendarDays(new Date(), day));
  if (daysAgo === 0) return "Completed today";
  if (daysAgo === 1) return "Completed yesterday";
  // Only ever 2-6 here -- 0 and 1 are handled above, so this never needs
  // to resolve a singular "1 day ago".
  if (daysAgo < 7) return `Completed ${daysAgo} days ago`;
  // Past a week, a date is more useful than a growing day count.
  const sameYear = day.getFullYear() === new Date().getFullYear();
  return `Completed ${format(day, sameYear ? "MMM d" : "MMM d, yyyy")}`;
}

// Same change as Social.jsx's RankIcon, for the same reasons: the icons
// carry no text, so the place -- the single most important fact in a
// leaderboard row -- was announced as nothing at all for the top three.
// Same inline strip ChallengeLeaderboard already uses for this exact job
// (a failed fetch inside an otherwise-usable card), so a load failure looks
// the same wherever it happens in this feature rather than inventing a
// second error language one folder over.
function LoadErrorStrip({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive-text text-xs">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-semibold underline underline-offset-2 shrink-0 h-11 px-1"
      >
        Retry
      </button>
    </div>
  );
}

function RankIcon({ rank, isTied }) {
  const label = isTied ? `Tied for ${ordinal(rank)}` : ordinal(rank);
  const icon =
    rank === 1 ? <Crown className="w-4 h-4 text-yellow-500" aria-hidden="true" /> :
    rank === 2 ? <Medal className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> :
    rank === 3 ? <Medal className="w-4 h-4 text-amber-600" aria-hidden="true" /> :
    <span className="text-xs font-bold text-muted-foreground w-4 text-center tabular-nums" aria-hidden="true">#{rank}</span>;

  return (
    <>
      {icon}
      <span className="sr-only">{label}</span>
    </>
  );
}

function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function getInviteLink(code) {
  return `${window.location.origin}?join=${code}`;
}

export default function GroupDashboard({ group, userId, userEmail, userFullName, profiles = [], onBack, onUpdate, onDelete, onRemoveMember, onSessionStarted }) {
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(null);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [viewingChallenge, setViewingChallenge] = useState(false);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const [assistCandidate, setAssistCandidate] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [startingSession, setStartingSession] = useState(false);

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

  const {
    data: habits = [],
    isLoading: habitsLoading,
    isError: habitsError,
    refetch: refetchHabits,
  } = useQuery({
    queryKey: ["habits", userEmail],
    queryFn: () => userEmail
      ? Habit.filter({ created_by: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail,
    // Matches Dashboard.jsx/Social.jsx's staleTime on this same query key
    // -- see Social.jsx's comment on its own habits query for why.
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: challenges = [],
    isError: challengesError,
    refetch: refetchChallenges,
  } = useQuery({
    queryKey: ["group-challenges", group.id],
    queryFn: () => GroupChallenge.filter(
      { group_id: group.id },
      "-created_date"
    ),
    enabled: !!group.id,
  });

  // Freeze Assist (Pro-exclusive): who in this group currently has a habit
  // eligible for a freeze. Only fetched for Pro users -- Free can't act on
  // this, and get_group_freeze_candidates does real cross-member work
  // server-side, not worth running for someone who could never use it.
  const { data: freezeCandidates = [], isError: freezeError } = useQuery({
    queryKey: ["group-freeze-candidates", group.id, todayStr],
    queryFn: () => getGroupFreezeCandidates(group.id, todayStr),
    enabled: !!group.id && isPro,
    staleTime: 5 * 60 * 1000,
  });
  const freezeCandidateByEmail = new Map(freezeCandidates.map((c) => [c.member_email, c]));

  const assistFreezeMutation = useMutation({
    mutationFn: ({ targetEmail, habitId, missedDate }) => assistFreeze(targetEmail, habitId, missedDate, group.id),
    onSuccess: (result, vars) => {
      if (!result.success) {
        toast.error(result.reason || "Couldn't save that streak. Please try again.", { duration: 3500 });
        return;
      }
      trackEvent("freeze_assist_used");
      queryClient.invalidateQueries({ queryKey: ["group-freeze-candidates", group.id] });
      // The assist is now a feed event too.
      queryClient.invalidateQueries({ queryKey: ["group-activity", group.id] });
      toast.success(`Streak saved! ${vars.targetName} will see it was you. 🔥`, { duration: 3000 });
    },
    onError: () => {
      toast.error("Couldn't save that streak. Please try again.", { duration: 3500 });
    },
  });

  const createChallengeMutation = useMutation({
    mutationFn: (data) => GroupChallenge.create(data),
    // habit_name now comes from newChallenge (the inserted row, with the
    // group_challenges_set_habit_name trigger's server-derived value),
    // not vars (the client-submitted payload) -- the client no longer
    // sends habit_name at all now that habit selection is habit_id-based.
    onSuccess: (newChallenge, vars) => {
      trackEvent("challenge_started");
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
      queryClient.invalidateQueries({ queryKey: ["challenge-notifications"] });

      // Fire a ChallengeNotification for every member except the admin who
      // started it -- one batched insert instead of N separate .create()
      // calls, since these are naturally one write (same challenge, same
      // starter, only recipient_email varies per row).
      const otherMembers = (group.member_emails || []).filter((e) => e !== userEmail);
      const adminName = getDisplayName(userEmail, profiles) || userFullName || userEmail.split("@")[0];
      // Deliberately NOT awaited, and no longer ahead of the toast.
      //
      // This used to be `await`ed at the top of onSuccess, which meant a
      // failed notification insert threw before the toast and before
      // setViewingChallenge -- so the challenge was live for the whole
      // group, nobody had been told, and the admin was left looking at a
      // modal stuck on "Creating…". A notification failure must never
      // present as a creation failure: by the time we are in onSuccess the
      // challenge exists, and that is the fact the admin needs.
      ChallengeNotification.createMany(
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
      ).catch((err) => {
        console.error("Challenge created but notifications failed:", err);
        toast.error("Challenge started, but we couldn't notify everyone. They'll still see it in the group.", { duration: 5000 });
      });

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
    // The only one of this file's three mutations that had no onError.
    // GroupChallenge.create can genuinely fail --
    // enforce_challenge_duration_plan_limit_trigger (20260915090002)
    // exists precisely to reject a duration a Free plan may not use -- and
    // without this the rejection surfaced nowhere at all.
    onError: (err) => {
      console.error("Failed to create challenge:", err);
      const message = err?.message?.includes("duration")
        ? "That challenge length isn't available on your plan."
        : "Couldn't start the challenge. Check your connection and try again.";
      toast.error(message, { duration: 4000 });
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

  const unrankedRows = memberEmails.map((email) => {
    const name = email === userEmail
      ? (getDisplayName(email, profiles) !== email.split("@")[0] ? getDisplayName(email, profiles) : (userFullName || getDisplayName(email, profiles)))
      : getDisplayName(email, profiles);
    if (email === userEmail) {
      return { email, name, isMe: true, isPro, ...myStats, topHabit: myTopHabit, lastCompletionDate: null, hasData: true };
    }
    const memberProfile = profiles.find((p) => p.created_by === email);
    if (!memberProfile) {
      // Private profile (is_public = false, invisible under RLS) or no
      // profile row created yet (it's written lazily, on first display-name
      // save) -- an honest "no data" state, not a real 0. Showing a bare 0
      // here was the bug: indistinguishable from a genuine score of zero.
      // The two causes are indistinguishable from the client too, so the
      // copy states the fact without asserting which one it is.
      return { email, name, isMe: false, isPro: false, score: null, bestStreak: 0, consistency: 0, topHabit: null, lastCompletionDate: null, hasData: false };
    }
    return {
      email,
      name,
      isMe: false,
      isPro: memberProfile.plan === "pro",
      score: (memberProfile.best_streak || 0) * 2 + (memberProfile.consistency_score || 0),
      bestStreak: memberProfile.best_streak || 0,
      consistency: memberProfile.consistency_score || 0,
      // Stays null for everyone but you, and not as a placeholder: another
      // member's habits are unreadable under RLS, so there is no top habit
      // to resolve. describeMemberActivity covers their line instead.
      topHabit: null,
      lastCompletionDate: memberProfile.last_completion_date || null,
      hasData: true,
    };
  });

  // Equal scores share a place rather than being separated by whatever
  // order member_emails happened to be in -- see assignCompetitionRanks in
  // lib/utils. A member with no readable profile keeps score: null, gets a
  // position, and is never reported as tied with another one.
  const rows = assignCompetitionRanks(
    unrankedRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  );

  // One tap, 25 minutes, straight to the lobby. The group screen
  // deliberately does not ask for a duration: the lobby is where you find
  // out who is coming, and 25 is both the existing default and the
  // shortest option, so this is the smallest commitment on offer. Anyone
  // wanting 45 or 60 still has the full modal on the Habits screen.
  const handleSitWithUs = async () => {
    if (startingSession) return;
    setStartingSession(true);
    try {
      const session = await startFocusSession({
        userEmail,
        userName: userFullName || getDisplayName(userEmail, profiles),
        group,
        durationMinutes: DEFAULT_DURATION_MINUTES,
      });
      // Hands the session up the same way StartFocusModal's
      // onSessionCreated does, so the room opens over whichever page
      // rendered this screen.
      onSessionStarted?.(session);
    } catch (err) {
      console.error("Failed to start focus session:", err);
      toast.error("Couldn't start the session. Check your connection and try again.");
    } finally {
      setStartingSession(false);
    }
  };

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
          <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={() => setViewingChallenge(false)} aria-label="Back to group">
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
        {/* Invite, the weekly report and the invite code all sit below the
          live content now. The old order led with Invite -- the rarest
          action on the screen -- and put the only time-sensitive element,
          an active challenge, last. These are the things you come here for
          occasionally, so they read in that order.

          Invite stays a real button rather than moving into the settings
          sheet: GroupSettingsModal shows the invite code and can
          regenerate it, but it has no share action, so InviteMembersSheet
          is the only path to one. Demoted, not removed. */}
      <Button
        variant="outline"
        className="w-full gap-2 rounded-xl h-11 border-primary/30 text-primary hover:bg-primary/5"
        onClick={() => setShowInvite(true)}
      >
        <Share2 className="w-4 h-4" />
        Invite Members
      </Button>

      {!isAdmin && group.invite_code && (
        <div className="flex items-center gap-2 bg-muted/60 rounded-xl px-3 py-2">
          <span className="text-xs text-muted-foreground flex-1 font-mono truncate">{group.invite_code}</span>
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => handleCopy(group.invite_code, "code")} aria-label={copied === "code" ? "Copied!" : "Copy invite code"}>
            {copied === "code" ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full gap-2 rounded-xl h-11"
        onClick={() => setShowWeeklyReport(true)}
      >
        📊 Last week's report
      </Button>

      <CreateChallengeModal
          open={showCreateChallenge}
          onOpenChange={setShowCreateChallenge}
          group={group}
          userHabits={habits}
          onCreate={(data) => createChallengeMutation.mutateAsync(data)}
          isPro={isPro}
          onUpgradeClick={() => setShowUpgrade(true)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full shrink-0" onClick={onBack} aria-label="Back to groups">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-lg truncate">{group.name}</h2>
          <p className="text-xs text-muted-foreground">{memberEmails.length} member{memberEmails.length !== 1 ? "s" : ""}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={() => setShowSettings(true)} aria-label="Group settings">
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* The screen's one primary action, and the only filled button on it.
          PRODUCT.md names synchronised sessions as the mechanism the whole
          app is organised around, and this was the one surface listing
          your friends by name where you could not start one with them --
          Social's groups LIST offered it, and it disappeared the moment
          you opened a group. It is also what generates the activity this
          screen now records. */}
      <Button
        className="w-full gap-2 rounded-xl h-11 font-semibold"
        onClick={handleSitWithUs}
        disabled={startingSession}
      >
        <Users className="w-4 h-4" />
        {startingSession ? "Starting…" : "Sit with us now"}
      </Button>
      <p className="text-xs text-muted-foreground text-center -mt-2">
        Starts a 25-minute session · everyone here gets a nudge to join
      </p>

      <GroupActivityFeed
        groupId={group.id}
        userEmail={userEmail}
        profiles={profiles}
        memberCount={memberEmails.length}
        isSolo={memberEmails.length <= 1}
      />

      {/* Leaderboard, now below the feed rather than being the screen's
          whole point. Unchanged otherwise: the score feeds Social's own
          leaderboard and the badge definitions, and ranking is a real
          draw for part of the audience. The screen gains a purpose rather
          than trading one away. */}
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

        {/* Your own row is computed from your habits, so until that query
            resolves the leaderboard cannot say where you place. It used to
            render anyway -- 0 pts and "No habits yet" -- which showed you
            as the group's worst performer for a spinner's worth of
            latency, and permanently if the fetch failed. */}
        {habitsLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading leaderboard">
            {Array.from({ length: Math.min(rows.length || 3, 5) }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-primary/10 animate-pulse" />
            ))}
          </div>
        ) : habitsError ? (
          <LoadErrorStrip
            message="Couldn't load your habits, so your score is missing."
            onRetry={() => refetchHabits()}
          />
        ) : (
        <>
        {freezeError && isPro && (
          <p className="text-xs text-muted-foreground mb-2">
            Couldn&apos;t check who needs a streak save right now.
          </p>
        )}
        {rows.map((row) => (
          <div key={row.email} className={cn(
            "flex items-center gap-3 p-2 rounded-xl",
            // row.rank, not the row's index: the top-three highlight now
            // follows the place awarded, so both halves of a tie for 3rd
            // are lit rather than just whichever one sorted first.
            row.isMe ? "bg-primary/5 ring-1 ring-primary/20" : row.rank <= 3 ? "bg-muted/50" : ""
          )}>
            <div className="w-6 flex items-center justify-center shrink-0">
              <RankIcon rank={row.rank} isTied={row.isTied} />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {row.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1">
                {row.hasData && <span className="mr-1">{getRank(row.score).emoji}</span>}
                <span className="truncate">{row.name}</span>
                {row.isPro && <Sparkles className="w-3 h-3 shrink-0 text-primary" aria-label="Pro member" />}
                {row.isMe && <span className="text-xs text-primary font-normal shrink-0">(you)</span>}
              </p>
              {/* Your own row is the only one that can name a habit: your
                  habits are the only ones this session can read. Everyone
                  else gets the recency line, which is real data, or copy
                  that says plainly that nothing is visible. */}
              {row.topHabit ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Flame className="w-3 h-3 text-accent shrink-0" />
                  <span className="truncate">
                    {row.topHabit.name} · {calculateStreak(row.topHabit.completions || [])}d streak
                  </span>
                </p>
              ) : row.isMe ? (
                <p className="text-xs text-muted-foreground truncate">No habits yet</p>
              ) : row.hasData ? (
                <p className="text-xs text-muted-foreground truncate">
                  {describeMemberActivity(row.lastCompletionDate)}
                </p>
              ) : (
                // Cause-neutral on purpose. This branch means no readable
                // user_profiles row came back for them, which has two
                // possible causes -- is_public = false, or no profile row
                // at all -- and the client cannot tell which. It also can't
                // honestly lead with privacy: nothing in the product sets
                // is_public to false (it defaults true in 20260702120002
                // and saveMyDisplayName hardcodes true), so the reachable
                // cause today is a profile that was never written, because
                // onboarding fires that save without awaiting it. Naming
                // privacy as the explanation would be a guess, and a wrong
                // one most of the time.
                //
                // Previously this carried a `title` spelling both causes
                // out, which is not a real affordance here: this ships as
                // a mobile-first PWA, and a title tooltip needs a hover a
                // touch screen never produces. The visible line has to
                // stand on its own, so it does.
                <p className="text-xs text-muted-foreground truncate">No progress shared yet</p>
              )}
            </div>
            <div className="text-right shrink-0">
              {row.hasData ? (
                <>
                  <p className="text-sm font-bold tabular-nums">{row.score}</p>
                  {/* The tie rides on the unit line rather than taking a
                      third line of its own, which would make tied rows
                      taller than untied ones and leave the list ragged.
                      Already announced by RankIcon's accessible name, so
                      this is aria-hidden to avoid saying it twice. */}
                  <p className="text-[10px] text-muted-foreground">
                    pts{row.isTied && <span aria-hidden="true"> · tied</span>}
                  </p>
                </>
              ) : (
                // The name line already explains this state -- repeating it
                // here read as two separate problems. A dash holds the
                // column visually; the sr-only text keeps the row from
                // going silent where every other row announces a score,
                // without making a screen reader hear the explanation twice.
                <p className="text-sm text-muted-foreground">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">No score</span>
                </p>
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
            {/* Freeze Assist: only ever visible to a Pro viewer, and only
                for a groupmate get_group_freeze_candidates actually found
                eligible right now -- most rows never show this. */}
            {!row.isMe && isPro && freezeCandidateByEmail.has(row.email) && (
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 shrink-0"
                style={{ color: "hsl(var(--frozen-text))" }}
                onClick={() => setAssistCandidate({ ...freezeCandidateByEmail.get(row.email), targetName: row.name })}
                aria-label={`Save ${row.name}'s streak`}
                title={`Save ${row.name}'s streak`}
              >
                ❄️
              </Button>
            )}
            {/* Member removal used to live here, as a per-row icon that
                swapped into an inline Remove/Cancel pair. It is gone, in
                favour of the identical flow GroupSettingsModal already
                owns (reached via the gear in the header), which is the
                correct one in every respect this one was not:
                  * it names the person ("Remove {name} from the group?")
                    where this confirm said only "Remove";
                  * it awaits the call and reports failure, where this
                    fired `onRemoveMember(row.email)` and discarded the
                    promise -- groups_update is creator-only, so a failed
                    write was an unhandled rejection with no toast and no
                    restored state, and the row simply reappeared on the
                    next refetch;
                  * it shows a "Removing…" pending state, where this had
                    none;
                  * and it uses the member's display name in its
                    aria-label, where this read out a raw email address
                    exposed nowhere else on the screen.
                Removing it also unstacks the row: react, Save-streak and
                remove-member were three adjacent ghost buttons at the
                right edge, one of them irreversible, with no visual
                weight to tell them apart under a thumb. */}
          </div>
        ))}
        </>
        )}
      </div>

      {/* A "Habits being tracked" card used to sit here, listing category
          counts as "{n} members tracking". It was built from `habits`, which
          is Habit.filter({ created_by: userEmail }) -- the viewer's own
          habits and nobody else's, because habits_select_own is owner-only.
          So it reported your three Health habits to the group as "3 members
          tracking Health", in a group that might have one member.
          Deleted rather than relabelled: nothing the client can read makes
          an honest group-level statement about habits. If the signal is
          wanted back, it needs a get_group_habit_categories(p_group_id)
          SECURITY DEFINER RPC alongside get_group_freeze_candidates
          (20260915090003), returning distinct-member counts per category. */}
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
      ) : challengesError ? (
        // Not the "Start a Group Challenge" CTA. A failed challenges fetch
        // leaves activeChallenge undefined, which is indistinguishable from
        // "this group has no challenge" -- so the admin was invited to
        // start a second one on top of a live challenge they simply
        // couldn't see.
        <LoadErrorStrip
          message="Couldn't load this group's challenges."
          onRetry={() => refetchChallenges()}
        />
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
        isPro={isPro}
        onUpgradeClick={() => setShowUpgrade(true)}
      />

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      <InviteMembersSheet
        open={showInvite}
        onOpenChange={setShowInvite}
        group={group}
      />

      <FreezeAssistConfirmModal
        open={!!assistCandidate}
        onOpenChange={(open) => { if (!open) setAssistCandidate(null); }}
        targetName={assistCandidate?.targetName}
        habitName={assistCandidate?.habit_name}
        onConfirm={() => {
          if (!assistCandidate) return;
          assistFreezeMutation.mutate({
            targetEmail: assistCandidate.member_email,
            habitId: assistCandidate.habit_id,
            missedDate: assistCandidate.missed_date,
            targetName: assistCandidate.targetName,
          });
        }}
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