import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Habit, UserProfile, Group, Reaction, GroupChallenge, ChallengeNotification } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format, subDays } from "date-fns";
import { Users, Trophy, Plus, LogIn, Crown, Medal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRank } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import { getAllTimeBest } from "@/components/habits/MilestoneBadges";
import { cn } from "@/lib/utils";
import CreateGroupModal from "@/components/groups/CreateGroupModal";
import JoinGroupModal from "@/components/groups/JoinGroupModal";
import JoinFocusModal from "@/components/focus/JoinFocusModal";
import SessionRoom from "@/components/focus/SessionRoom";
import GroupDashboard from "@/components/groups/GroupDashboard";
import GroupsEmptyState from "@/components/groups/GroupsEmptyState";
import GroupMilestoneNotifier from "@/components/groups/GroupMilestoneNotifier";
import ScoreHistoryChart from "@/components/social/ScoreHistoryChart";
import ReactionsInbox from "@/components/social/ReactionsInbox";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import UpgradeModal from "@/components/upgrade/UpgradeModal";
import { useSubscription } from "@/hooks/useSubscription";

function calcConsistency(completions) {
  if (!completions?.length) return 0;
  const last30 = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
  return Math.round(last30.filter((d) => completions.includes(d)).length / 30 * 100);
}

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-muted-foreground" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center">#{rank}</span>;
}

const LeaderboardRow = React.memo(function LeaderboardRow({ rank, entry }) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-xl transition-colors",
      rank <= 3 ? "bg-muted/60" : "hover:bg-muted/40"
    )}>
      <div className="w-8 flex items-center justify-center shrink-0">
        <RankIcon rank={rank} />
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
        <p className="text-sm font-bold text-foreground">{entry.score}</p>
        <p className="text-[10px] text-muted-foreground">points</p>
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
  // Dashboard.jsx's joinFocusSession consumer.
  useEffect(() => {
    if (location.state?.selectGroup) {
      setSelectedGroup(location.state.selectGroup);
      setActiveTab("groups");
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

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["groups", user?.email],
    queryFn: () => user?.email ?
    Group.filter({
      '$or': [
      { created_by: user.email },
      { member_emails: { '$in': [user.email] } }]

    }, "-created_date") :
    [],
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000
  });

  const { data: reactions = [] } = useQuery({
    queryKey: ["reactions", user?.email],
    queryFn: () => user?.email ?
    Reaction.filter({ recipient_email: user.email }, "-created_date") :
    [],
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000
  });

  // Reactions are already scoped to current user by the query
  const myReactions = reactions;
  const unreadCount = reactions.filter((r) => !r.read).length;

  const markReactionsRead = () => {
    reactions.filter((r) => !r.read).forEach((r) => {
      Reaction.update(r.id, { read: true }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["reactions", user?.email] });
      });
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

  // Build leaderboard from profiles + current user's own data. Memoized so
  // LeaderboardRow (React.memo below) can actually skip re-rendering when
  // unrelated Social state changes -- this array (and every entry object
  // in it) was previously rebuilt from scratch on every render regardless.
  const leaderboard = useMemo(() => {
    const myDisplayName = getDisplayName(user?.email, profiles) !== user?.email?.split("@")[0] ?
    getDisplayName(user?.email, profiles) :
    user?.full_name || getDisplayName(user?.email, profiles);

    const myBestStreak = Math.max(...habits.map((h) => getAllTimeBest(h.completions || [])), 0);
    const myConsistency = habits.length ?
    Math.round(habits.reduce((s, h) => s + calcConsistency(h.completions || []), 0) / habits.length) :
    0;

    return [
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
    filter((p) => p.is_public !== false && p.created_by !== user?.email).
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
  }, [user?.email, user?.full_name, profiles, habits, isPro]);

  const myGroups = groups.filter(
    (g) => g.created_by === user?.email || (g.member_emails || []).includes(user?.email)
  );

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

  const removeMember = (group, email) => {
    const emails = (group.member_emails || []).filter((e) => e !== email);
    return updateGroupMutation.mutateAsync({ id: group.id, data: { member_emails: emails } });
  };

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
              ChallengeNotification.update(event.id, { dismissed: true }).then(() => {
                queryClient.invalidateQueries({ queryKey: ["challenge-notifications", user.email] });
              });
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
            <TabsTrigger value="leaderboard" className="flex-1 gap-2 text-xs">
              <Trophy className="w-4 h-4" /> Leaderboard
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex-1 gap-2 text-xs">
              <Users className="w-4 h-4" /> Groups
            </TabsTrigger>
            <TabsTrigger value="reactions" className="flex-1 gap-2 relative text-xs">
              <span>🫶</span> Reactions
              {unreadCount > 0 &&
              <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-destructive" />
              }
            </TabsTrigger>
          </TabsList>

          {/* LEADERBOARD TAB */}
          <TabsContent value="leaderboard" className="space-y-4">
            {leaderboard.length >= 3 ?
            <Card className="border-0 shadow-sm p-4 space-y-1">
                <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">
                  Score = Best Streak × 2 + Consistency %
                </p>
                {leaderboard.map((entry, i) =>
              <div key={entry.id} className={cn(entry.isMe && "ring-1 ring-primary/30 rounded-xl")}>
                    <LeaderboardRow rank={i + 1} entry={entry} />
                  </div>
              )}
              </Card> :

            <ScoreHistoryChart
              habits={habits}
              onInvite={() => {
                if (navigator.share) {
                  navigator.share({ title: "Join me on Strk!", text: "Build streaks. Stay accountable. Join me on Strk!", url: window.location.origin });
                } else {
                  navigator.clipboard.writeText(window.location.origin);
                  alert("Link copied! Share Strk with friends.");
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
              onRemoveMember={(email) => removeMember(activeGroup, email)} /> :

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
                {myGroups.map((group) =>
              <Card
                key={group.id}
                className="border-0 shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedGroup(group.id)}>
                
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{group.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(group.member_emails || []).length} member{(group.member_emails || []).length !== 1 ? "s" : ""}
                          {group.created_by_id === user?.id && " · Admin"}
                        </p>
                        {group.description &&
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{group.description}</p>
                    }
                      </div>
                      <Trophy className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </Card>
              )}
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