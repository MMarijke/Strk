import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Habit, UserProfile, Group, Reaction, GroupChallenge, ChallengeNotification, AccountabilityPartnership } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Users, Trophy, Plus, LogIn, Crown, Medal, Sparkles, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRank, assignCompetitionRanks, ordinal, calculateStats } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import { removeGroupMember } from "@/lib/groupService";
import { cn } from "@/lib/utils";
import CreateGroupModal from "@/components/groups/CreateGroupModal";
import JoinGroupModal from "@/components/groups/JoinGroupModal";
import JoinFocusModal from "@/components/focus/JoinFocusModal";
import SessionRoom from "@/components/focus/SessionRoom";
import GroupDashboard from "@/components/groups/GroupDashboard";
import GroupsEmptyState from "@/components/groups/GroupsEmptyState";
import GroupMilestoneNotifier from "@/components/groups/GroupMilestoneNotifier";
import AccountabilityPartnerPanel from "@/components/accountability/AccountabilityPartnerPanel";
import ScoreHistoryChart from "@/components/social/ScoreHistoryChart";
import ReactionsInbox from "@/components/social/ReactionsInbox";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import UpgradeModal from "@/components/upgrade/UpgradeModal";
import { useSubscription } from "@/hooks/useSubscription";
import { useSocialActivity } from "@/hooks/useSocialActivity";

// The icons carry no text, so a screen reader previously heard nothing at
// all for the top three places and a bare "#4" for the rest. The place is
// the single most important fact in a leaderboard row, so it gets a real
// accessible name -- and when it's shared, says so.
function RankIcon({ rank, isTied }) {
  const label = isTied ? `Tied for ${ordinal(rank)}` : ordinal(rank);
  const icon =
    rank === 1 ? <Crown className="w-5 h-5 text-yellow-500" aria-hidden="true" /> :
    rank === 2 ? <Medal className="w-5 h-5 text-muted-foreground" aria-hidden="true" /> :
    rank === 3 ? <Medal className="w-5 h-5 text-amber-600" aria-hidden="true" /> :
    <span className="text-sm font-bold text-muted-foreground w-5 text-center tabular-nums" aria-hidden="true">#{rank}</span>;

  return (
    <>
      {icon}
      <span className="sr-only">{label}</span>
    </>
  );
}

const LeaderboardRow = React.memo(function LeaderboardRow({ entry }) {
  // entry.rank, not the row's index: equal scores share a place, so the
  // position in the list and the place awarded are no longer the same
  // number. The highlight follows the place too, so both halves of a tie
  // for 3rd are lit rather than just whichever one sorted first.
  const { rank, isTied } = entry;
  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-xl transition-colors",
      rank <= 3 ? "bg-muted/60" : "hover:bg-muted/40"
    )}>
      <div className="w-8 flex items-center justify-center shrink-0">
        <RankIcon rank={rank} isTied={isTied} />
      </div>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
        style={{ backgroundColor: entry.avatarColor || "hsl(var(--primary))" }}>
        
        {(entry.name || "?")[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate flex items-center gap-1">
          <span className="mr-1">{getRank(entry.score).emoji}</span>
          <span className="truncate">{entry.name}</span>
          {entry.isPro && (
            <Sparkles
              className="w-3 h-3 shrink-0 text-primary"
              aria-label="Pro member"
            />
          )}
        </p>
        <p className="text-xs text-muted-foreground">{entry.consistency}% consistency</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-foreground tabular-nums">{entry.score}</p>
        {/* The tie rides on the unit line rather than taking a third line
            of its own, which would make tied rows taller than untied ones
            and leave the list ragged. Already announced by RankIcon's
            accessible name, so this is aria-hidden to avoid saying it
            twice. */}
        <p className="text-[10px] text-muted-foreground">
          points{isTied && <span aria-hidden="true"> · tied</span>}
        </p>
      </div>
    </div>);

});

export default function Social() {
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-join focus session from URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focusCode = params.get("focus");
    if (focusCode && user?.email) {
      setShowJoinFocus(true);
    }
  }, [user?.email]);

  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showJoinFocus, setShowJoinFocus] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [activeTab, setActiveTab] = useState("leaderboard");

  // ChallengeStartBanner/ChallengeBanner (Dashboard.jsx) deep-link here via
  // router state instead of landing generically on whatever tab happened
  // to be active -- same location.state hand-off pattern as
  // Dashboard.jsx's joinFocusSession consumer. FriendActivityStrip
  // (Dashboard.jsx) reuses the same `tab` hand-off to land directly on
  // the reactions tab.
  useEffect(() => {
    if (location.state?.selectGroup) {
      setSelectedGroup(location.state.selectGroup);
      setActiveTab("groups");
      navigate(location.pathname, { replace: true, state: null });
    } else if (location.state?.tab) {
      setActiveTab(location.state.tab);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const { data: habits = [] } = useQuery({
    queryKey: ["habits", user?.email],
    queryFn: () => user?.email ?
    Habit.filter({ created_by: user.email }, "-created_date") :
    [],
    enabled: !!user?.email,
    // Matches Dashboard.jsx's staleTime on this same query key -- was
    // 2min here, unset (defaulting to 0) on GroupDashboard.jsx's copy of
    // this same query, so navigating Dashboard -> Social -> into a group
    // triggered a background refetch of the full habits list at each
    // step even when the data was already fresh.
    staleTime: 5 * 60 * 1000
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["user-profiles"],
    queryFn: () => UserProfile.list("-best_streak"),
    staleTime: 5 * 60 * 1000
  });

  const { groups, groupsLoading, reactions } = useSocialActivity();

  // Reactions are already scoped to current user by the query
  const myReactions = reactions;
  const unreadCount = reactions.filter((r) => !r.read).length;

  // One write per unread reaction, each fire-and-forget: a failure leaves
  // that reaction unread so it is counted again next time, which is the
  // honest outcome. Caught per-promise rather than around the forEach --
  // the loop has already returned by the time any of them settle, so a
  // try/catch there would catch nothing.
  const markReactionsRead = () => {
    reactions.filter((r) => !r.read).forEach((r) => {
      Reaction.update(r.id, { read: true })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["reactions", user?.email] });
        })
        .catch((err) => console.error("Failed to mark reaction read:", err));
    });
  };

  const createGroupMutation = useMutation({
    mutationFn: (data) => Group.create(data),
    onSuccess: () => {
      trackEvent("group_created");
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    }
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }) => Group.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] })
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id) => {
      // Delete all challenges belonging to this group first
      const challenges = await GroupChallenge.filter({ group_id: id });
      await Promise.all(challenges.map((c) => GroupChallenge.delete(c.id)));
      return Group.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
      setSelectedGroup(null);
    }
  });

  const myGroups = groups.filter(
    (g) => g.created_by === user?.email || (g.member_emails || []).includes(user?.email)
  );

  // Dedup'd across every group -- source list for InvitePartnerModal's
  // "pick from a group" shortcut.
  const groupmateEmails = useMemo(() => {
    const set = new Set();
    myGroups.forEach((g) => (g.member_emails || []).forEach((e) => {
      if (e !== user?.email) set.add(e);
    }));
    return [...set];
  }, [myGroups, user?.email]);

  // Same queryKey AccountabilityPartnerPanel uses internally -- React Query
  // shares the one cache entry, so this doesn't add a second network call,
  // it just lets the tab itself show a dot for an actionable incoming
  // invite without duplicating the panel's own fetch/derivation logic.
  const { data: partnerships = [] } = useQuery({
    queryKey: ["accountability-partnerships", user?.email],
    queryFn: () => user?.email
      ? AccountabilityPartnership.filter({ $or: [{ requester_email: user.email }, { partner_email: user.email }] })
      : [],
    enabled: !!user?.email,
  });
  const hasPendingPartnerInvite = partnerships.some((p) => p.status === "pending" && p.partner_email === user?.email);

  // Everyone this user actually shares something with: a group, or an
  // active accountability partnership. This is the population the
  // leaderboard below is allowed to rank them against.
  //
  // It used to rank them against every profile the profiles query
  // returned, which is every account in the database: user_profiles_select
  // (20260702120003) permits `is_public = true` and that column defaults
  // to true, so UserProfile.list() hands back every stranger who has ever
  // signed up. (At the time nothing could set it false either; Settings >
  // Progress sharing now can, but that is a per-user choice and was never
  // a substitute for scoping the list to actual peers.)
  // The screen called that "Leaderboard" and showed the user their rank
  // inside it -- a number set by people they have never met, and one that
  // can only get less meaningful as the user base grows. It also
  // contradicts the premise the whole product is built on: progress is
  // meant to be witnessed by real friends, not measured against a crowd.
  const peerEmails = useMemo(() => {
    const set = new Set(groupmateEmails);
    partnerships.forEach((p) => {
      if (p.status !== "active") return;
      const theirEmail = p.requester_email === user?.email ? p.partner_email : p.requester_email;
      if (theirEmail && theirEmail !== user?.email) set.add(theirEmail);
    });
    return set;
  }, [groupmateEmails, partnerships, user?.email]);

  // Build leaderboard from the user's own data plus their peers' profiles.
  // Memoized so LeaderboardRow (React.memo above) can actually skip
  // re-rendering when unrelated Social state changes -- this array (and
  // every entry object in it) was previously rebuilt from scratch on every
  // render regardless.
  const leaderboard = useMemo(() => {
    const myDisplayName = getDisplayName(user?.email, profiles) !== user?.email?.split("@")[0] ?
    getDisplayName(user?.email, profiles) :
    user?.full_name || getDisplayName(user?.email, profiles);

    // Shared definition rather than a third copy of the same arithmetic.
    const { bestStreak: myBestStreak, consistency: myConsistency } = calculateStats(habits);

    const sorted = [
    {
      id: "me",
      name: myDisplayName,
      avatarColor: "hsl(var(--primary))",
      bestStreak: myBestStreak,
      consistency: myConsistency,
      score: myBestStreak * 2 + myConsistency,
      isMe: true,
      isPro
    },
    ...profiles.
    // is_public is honoured: a peer who turns off Progress sharing in
    // Settings stays out of the leaderboard. This filter predates that
    // switch existing and is what made adding it a UI-only change.
    filter((p) => p.is_public !== false && p.created_by !== user?.email && peerEmails.has(p.created_by)).
    map((p) => ({
      id: p.id,
      name: p.display_name || p.created_by?.split("@")[0] || "?",
      avatarColor: p.avatar_color,
      bestStreak: p.best_streak || 0,
      consistency: p.consistency_score || 0,
      score: (p.best_streak || 0) * 2 + (p.consistency_score || 0),
      isPro: p.plan === "pro"
    }))].
    sort((a, b) => b.score - a.score);

    // Equal scores share a place rather than being separated by whatever
    // order the rows arrived in -- see assignCompetitionRanks in lib/utils.
    return assignCompetitionRanks(sorted);
  }, [user?.email, user?.full_name, profiles, habits, isPro, peerEmails]);

  // The user is in their own leaderboard, so "is there anyone to compare
  // against" is a question about everyone else, not about the list length.
  //
  // The old gate was `leaderboard.length >= 3` against that same
  // all-accounts list, which stopped meaning anything the moment the app
  // had three signups: it was permanently true for everyone, so the invite
  // path below -- the one route from this screen toward actually having
  // friends here -- had become unreachable. Gated on real peers, it shows
  // exactly when it is true that there is nobody here yet.
  const hasPeersOnLeaderboard = leaderboard.some((entry) => !entry.isMe);

  // Checked here, before CreateGroupModal ever opens, rather than letting
  // it open and then swap to UpgradeModal via its own internal effect --
  // that open-then-immediately-correct pattern is exactly what produced
  // the visible flash the design critique flagged. CreateGroupModal keeps
  // its own paywalled check too, as a safety net for any other caller.
  const handleOpenCreate = () => {
    if (myGroups.length >= 2 && !isPro) {
      setShowUpgrade(true);
    } else {
      setShowCreate(true);
    }
  };

  // JoinGroupModal calls the join_group RPC itself (a non-member can't
  // SELECT/UPDATE the groups row directly under RLS, see the
  // 20260811090001 migration) and only invokes this once the join has
  // actually succeeded server-side -- this just reacts to that result.
  const handleGroupJoined = () => {
    trackEvent("group_joined");
    queryClient.invalidateQueries({ queryKey: ["groups"] });
  };

  // Through the remove_group_member RPC (20261025090002), not a direct
  // Group.update. Removing somebody has to reach the group's CHALLENGES
  // too, and the client cannot do that reliably: group_challenges_update
  // requires the challenge's own creator, while the remover is the group's
  // admin. Where those differ a client write matches zero rows and
  // silently succeeds, leaving the removed member on the challenge
  // leaderboard of a group they have left -- which is the bug. Two
  // sequential writes could also half-fail into the same state; the
  // function is atomic.
  const removeMemberMutation = useMutation({
    // Annotated because TanStack infers TVariables from mutationFn, and a
    // bare destructuring pattern in plain JS gives it nothing -- it falls
    // back to `void` and every call site then fails to typecheck.
    mutationFn: (/** @type {{ groupId: string, email: string }} */ { groupId, email }) =>
      removeGroupMember(groupId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      // The challenge rows changed too, so their leaderboards must refetch.
      queryClient.invalidateQueries({ queryKey: ["group-challenges"] });
      queryClient.invalidateQueries({ queryKey: ["challenge-progress"] });
    },
    onError: (err) => {
      toast.error(err?.message || "Couldn't remove that member. Please try again.", { duration: 3500 });
    },
  });

  const removeMember = (group, email) =>
    removeMemberMutation.mutateAsync({ groupId: group.id, email });

  const activeGroup = selectedGroup ? groups.find((g) => g.id === selectedGroup) : null;

  // Real-time: show a 5s toast when a new challenge notification arrives for this user
  const shownNotifIds = useRef(new Set());
  useEffect(() => {
    if (!user?.email) return;
    const unsubscribe = ChallengeNotification.subscribe((event) => {
      if (event.type !== "create") return;
      const notif = event.data;
      if (notif.recipient_email !== user.email) return;
      if (shownNotifIds.current.has(event.id)) return;
      shownNotifIds.current.add(event.id);

      const groupForChallenge = groups.find((g) => g.id === notif.group_id);

      toast(
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏆</span>
            <div>
              <p className="font-semibold text-sm text-foreground leading-tight">
                {notif.started_by_name || "Someone"} started a new challenge!
              </p>
              <p className="text-xs text-muted-foreground">{notif.habit_name} · {notif.duration_days} days · {notif.group_name}</p>
            </div>
          </div>
          <button
            className="w-full rounded-lg bg-primary text-primary-foreground text-xs font-semibold py-1.5 hover:bg-primary/90 transition-colors"
            onClick={() => {
              if (groupForChallenge) setSelectedGroup(groupForChallenge.id);
              setActiveTab("groups");
              // The navigation above has already happened, so a failed
              // dismiss just means the banner is still there when they come
              // back -- not worth interrupting the journey for.
              ChallengeNotification.update(event.id, { dismissed: true })
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ["challenge-notifications", user.email] });
                })
                .catch((err) => console.error("Failed to dismiss challenge notification:", err));
            }}>
            
            View Challenge →
          </button>
        </div>,
        {
          duration: 5000,
          dismissible: true
        }
      );
    });
    return unsubscribe;
  }, [user?.email, groups]);

  // The nudge listener used to live here, which was the bug: it was the only
  // subscriber in the app, so a nudge only ever reached a recipient who
  // happened to be on this page at that second. It is now
  // AccountabilityNudgeListener, mounted app-wide from AppLayout.jsx and
  // backed by the row's `read` flag, so one sent while the recipient is
  // anywhere else -- or has the app closed -- still arrives.

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pb-8" style={{ paddingTop: `calc(env(safe-area-inset-top) + 2rem)` }}>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Social
          </h1>
          <p className="text-sm text-muted-foreground">Groups & Leaderboard</p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => {setActiveTab(v);if (v === "reactions") markReactionsRead();}}>
          <TabsList className="w-full mb-6">
            <TabsTrigger value="leaderboard" className="flex-1 min-w-0 gap-1.5 text-xs">
              <Trophy className="w-4 h-4 shrink-0" /> <span className="truncate min-w-0">Leaderboard</span>
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex-1 min-w-0 gap-1.5 text-xs">
              <Users className="w-4 h-4 shrink-0" /> <span className="truncate min-w-0">Groups</span>
            </TabsTrigger>
            <TabsTrigger value="reactions" className="flex-1 min-w-0 gap-1.5 relative text-xs">
              <span className="shrink-0">🫶</span> <span className="truncate min-w-0">Reactions</span>
              {unreadCount > 0 &&
              <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-destructive" />
              }
            </TabsTrigger>
            <TabsTrigger value="partner" className="flex-1 min-w-0 gap-1.5 relative text-xs">
              <Handshake className="w-4 h-4 shrink-0" /> <span className="truncate min-w-0">Partner</span>
              {hasPendingPartnerInvite &&
              <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-destructive" />
              }
            </TabsTrigger>
          </TabsList>

          {/* LEADERBOARD TAB */}
          <TabsContent value="leaderboard" className="space-y-4">
            {hasPeersOnLeaderboard ?
            <Card className="border-0 shadow-sm p-4 space-y-1">
                {/* Names the population before the formula. A leaderboard
                    that doesn't say who is on it invites the reader to
                    assume the widest possible answer, which is what this
                    one used to actually do. */}
                <p className="text-xs font-semibold text-foreground">
                  You and the people you share groups with
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Score = Best Streak × 2 + Consistency %
                </p>
                {leaderboard.map((entry) =>
              <div key={entry.id} className={cn(entry.isMe && "ring-1 ring-primary/30 rounded-xl")}>
                    <LeaderboardRow entry={entry} />
                  </div>
              )}
              </Card> :

            <ScoreHistoryChart
              habits={habits}
              onInvite={() => {
                if (navigator.share) {
                  // Dismissing the share sheet rejects with AbortError --
                  // an unhandled rejection, not a failure worth reporting.
                  navigator.share({ title: "Join me on Strk!", text: "Build streaks. Stay accountable. Join me on Strk!", url: window.location.origin }).catch(() => {});
                } else {
                  // Was a native alert(), the one in the app: a modal OS
                  // dialog for a routine success, in a PWA where every
                  // other confirmation is a toast. Also now reports
                  // failure instead of claiming a copy that didn't happen
                  // -- clipboard writes reject without a user gesture or
                  // permission.
                  navigator.clipboard.writeText(window.location.origin).
                  then(() => toast.success("Invite link copied — send it to a friend.")).
                  catch(() => toast.error("Couldn't copy the link. Long-press the address bar to copy it instead."));
                }
              }} />

            }
          </TabsContent>

          {/* GROUPS TAB */}
          <TabsContent value="groups">
            {activeGroup ?
            <GroupDashboard
              group={activeGroup}
              userId={user?.id}
              userEmail={user?.email}
              userFullName={user?.full_name}
              profiles={profiles}
              onBack={() => setSelectedGroup(null)}
              onUpdate={(data) => updateGroupMutation.mutateAsync({ id: activeGroup.id, data })}
              onDelete={() => deleteGroupMutation.mutateAsync(activeGroup.id)}
              onRemoveMember={(email) => removeMember(activeGroup, email)}
              // Same hand-off StartFocusModal's onSessionCreated uses, so
              // the room opens over this page exactly as it does when a
              // session is started from the Habits screen.
              onSessionStarted={(session) => setActiveSession(session)} /> :

            groupsLoading ?
            <div className="space-y-3">
                {[1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}
              </div> :

            myGroups.length === 0 ?
            <div className="space-y-3">
                <GroupsEmptyState onCreate={handleOpenCreate} onJoin={() => setShowJoin(true)} />
                <Button variant="outline" className="w-full gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/5" onClick={() => setShowJoinFocus(true)}>
                  🎯 Join Focus Session
                </Button>
              </div> :

            <div className="space-y-4">
                <div className="flex gap-2">
                  <Button className="flex-1 gap-2 rounded-xl" onClick={handleOpenCreate}>
                    <Plus className="w-4 h-4" /> Create
                  </Button>
                  <Button variant="outline" className="flex-1 gap-2 rounded-xl" onClick={() => setShowJoin(true)}>
                    <LogIn className="w-4 h-4" /> Join
                  </Button>
                </div>
                <Button variant="outline" className="w-full gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/5" onClick={() => setShowJoinFocus(true)}>
                  🎯 Join Focus Session
                </Button>
                {myGroups.map((group) => {
                // Computed once and used for both the visible line and the
                // accessible name, so the two can't drift apart.
                const memberCount = (group.member_emails || []).length;
                const isGroupAdmin = group.created_by_id === user?.id;
                const memberLabel = `${memberCount} member${memberCount !== 1 ? "s" : ""}`;
                return (
                  <Card
                    key={group.id}
                    // Same focusable-card pattern as HabitCard and
                    // WeeklySummaryCard: a div with onClick and nothing else
                    // is unreachable by keyboard and announces as plain text,
                    // so this whole card -- the only way into a group -- was
                    // a dead end for anyone not using a pointer. Takes
                    // FriendActivityStrip's version of the pattern, which
                    // adds the themed focus-visible ring the two older ones
                    // still lack: without it the card is now reachable by
                    // Tab but gives no indication of where focus landed,
                    // which trades one keyboard failure for another.
                    role="button"
                    tabIndex={0}
                    // Overriding the content as the accessible name, so it
                    // has to carry the same facts the card shows rather than
                    // just the group name. The description is deliberately
                    // left out: it's line-clamped supplementary text, and
                    // folding an arbitrary-length blurb into a button's name
                    // makes a list of groups slow to scan by ear.
                    aria-label={`Open ${group.name}, ${memberLabel}${isGroupAdmin ? ", you are an admin" : ""}`}
                    className={cn(
                      "border-0 shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow",
                      "outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    )}
                    onClick={() => setSelectedGroup(group.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        // Space would otherwise scroll the page instead of
                        // activating the card, which is what a real <button>
                        // does and what this role promises.
                        e.preventDefault();
                        setSelectedGroup(group.id);
                      }
                    }}>

                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Group names are unbounded -- CreateGroupModal's
                            input sets no maxLength and groups.name is a bare
                            `text` column -- so a long name, or one long
                            unbroken string, reaches this card and would
                            otherwise push the trophy off the row. */}
                        <p className="font-semibold text-sm truncate">{group.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {memberLabel}
                          {isGroupAdmin && " · Admin"}
                        </p>
                        {group.description &&
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{group.description}</p>
                    }
                      </div>
                      <Trophy className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </Card>
                );
              })}
              </div>
            }
          </TabsContent>
          {/* REACTIONS TAB */}
          <TabsContent value="reactions">
            <Card className="border-0 shadow-sm p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Reactions Received</p>
              <ReactionsInbox reactions={myReactions} />
            </Card>
          </TabsContent>
          {/* ACCOUNTABILITY PARTNER TAB */}
          <TabsContent value="partner">
            <AccountabilityPartnerPanel
              userEmail={user?.email}
              profiles={profiles}
              groupmateEmails={groupmateEmails}
              isPro={isPro}
              onUpgradeClick={() => setShowUpgrade(true)}
            />
          </TabsContent>
        </Tabs>
      </div>

      <GroupMilestoneNotifier groups={myGroups} habits={habits} userEmail={user?.email} />

      <CreateGroupModal
        open={showCreate}
        onOpenChange={setShowCreate}
        userEmail={user?.email}
        groupCount={myGroups.length}
        onUpgrade={() => setShowUpgrade(true)}
        onCreate={(data) => createGroupMutation.mutateAsync(data)} />

      <JoinGroupModal
        open={showJoin}
        onOpenChange={setShowJoin}
        onJoin={handleGroupJoined} />
      
      <JoinFocusModal
        open={showJoinFocus}
        onOpenChange={setShowJoinFocus}
        userEmail={user?.email}
        onSessionJoined={(s) => setActiveSession(s)} />
      
      {/* No onStartAnother passed here on purpose: this page has a join
          flow but no start flow (StartFocusModal lives on Dashboard), so
          the completion screen omits "Start another" rather than offering
          a button with nowhere to go. */}
      {activeSession &&
      <SessionRoom
        session={activeSession}
        userEmail={user?.email}
        userName={user?.full_name || user?.email?.split("@")[0]}
        onClose={() => setActiveSession(null)} />

      }

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>);

}