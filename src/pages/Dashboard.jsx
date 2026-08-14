import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UserProfile, Habit, Group } from "@/api/entities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";
import { startReminderScheduler } from "@/lib/notificationService";
import { startDigestScheduler } from "@/lib/groupDigestService";
import { calculateStreak } from "@/components/habits/StreakWidget";
import { Plus, CheckCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";
import HabitCard from "@/components/habits/HabitCard";
import StatsBar from "@/components/habits/StatsBar";
import AddHabitDialog from "@/components/habits/AddHabitDialog";
import FreezeIndicator from "@/components/habits/FreezeIndicator";
import { applyFreeze, getFreezeMonthState } from "@/lib/freezeService";
import { isSummaryVisible, scheduleWeeklySummaryNotif } from "@/lib/weeklySummaryService";
import ChallengeBanner from "@/components/habits/ChallengeBanner";
import PullToRefresh from "@/components/dashboard/PullToRefresh";
import TodayTray from "@/components/dashboard/TodayTray";
import RankCard from "@/components/rank/RankCard";
import RankUpModal from "@/components/rank/RankUpModal";
import { getRank, calculateScore } from "@/lib/utils";
import StartFocusModal from "@/components/focus/StartFocusModal";
import SessionRoom from "@/components/focus/SessionRoom";
import { trackEvent } from "@/lib/analytics";
import { useSubscription } from "@/hooks/useSubscription";
import { toast } from "sonner";

export default function Dashboard() {
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const location = useLocation();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [rankUpRank, setRankUpRank] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showFocusModal, setShowFocusModal] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  // null (not 0) while unloaded, so FreezeIndicator can distinguish "not
  // fetched yet" from a genuine, confirmed zero and render nothing rather
  // than flash "0 freezes" for the brief window before this resolves --
  // null behaves identically to 0 in every `> 0`/`<= 0` comparison
  // elsewhere, so nothing downstream needed to change for this.
  const [freezesRemaining, setFreezesRemaining] = useState(null);
  const [frozenHabits, setFrozenHabits] = useState({});
  const rankCheckTimeout = useRef(null);
  const queryClient = useQueryClient();

  const refreshFreezeState = useCallback(() => {
    if (!user?.email) return;
    getFreezeMonthState(user.email, isPro).then(({ freezesRemaining: remaining, frozenHabits: frozen }) => {
      setFreezesRemaining(remaining);
      setFrozenHabits(frozen);
    });
  }, [user?.email, isPro]);

  useEffect(() => {
    refreshFreezeState();
  }, [refreshFreezeState]);

  // Load user's profile (display name, highest rank) — plan/isPro comes from useSubscription
  useEffect(() => {
    if (!user?.email) return;
    UserProfile.filter({ created_by: user.email }).then((profiles) => {
      if (profiles.length > 0) {
        setUserProfile(profiles[0]);
      }
    });
  }, [user?.email]);

  const { data: allHabits = [], isLoading } = useQuery({
    queryKey: ["habits", user?.email],
    queryFn: () => user?.email
      ? Habit.filter({ created_by: user.email }, "-created_date")
      : [],
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });
  const habits = allHabits.filter((h) => !h.archived);

  const displayName = userProfile?.display_name
    || user?.full_name
    || user?.email?.split("@")[0]
    || "";

  const createMutation = useMutation({
    mutationFn: (data) => Habit.create(data),
    onSuccess: () => {
      trackEvent("habit_created");
      queryClient.invalidateQueries({ queryKey: ["habits", user?.email] });
    },
    onError: () => {
      toast.error("Couldn't add that habit. Please try again.", { duration: 3000 });
    },
  });

  // Tracks which habit ids currently have a write in flight -- lets
  // HabitCard disable just its own check button rather than either doing
  // nothing (the double-tap race below) or disabling every card's button
  // for any habit's update.
  const [pendingHabitIds, setPendingHabitIds] = useState(() => new Set());

  // Optimistic toggle mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => Habit.update(id, data),
    onMutate: async ({ id, data }) => {
      setPendingHabitIds((prev) => new Set(prev).add(id));
      await queryClient.cancelQueries({ queryKey: ["habits", user?.email] });
      const previous = queryClient.getQueryData(["habits", user?.email]);
      queryClient.setQueryData(["habits", user?.email], (old = []) =>
        old.map((h) => h.id === id ? { ...h, ...data } : h)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["habits", user?.email], context.previous);
      }
      toast.error("That didn't save. Please try again.", { duration: 3000 });
    },
    onSettled: (_data, _error, variables) => {
      setPendingHabitIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["habits", user?.email] });
      // habits_sync_profile_stats recomputes user_profiles server-side on
      // every habits write -- invalidate here too so leaderboards reading
      // that table (Badges.jsx's Top X%, other members' rows elsewhere)
      // pick up the fresh value without waiting out its 5min staleTime.
      queryClient.invalidateQueries({ queryKey: ["user-profiles"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => Habit.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["habits", user?.email] }),
    onError: () => {
      toast.error("Couldn't delete that habit. Please try again.", { duration: 3000 });
    },
  });

  const handleToggleToday = (habit) => {
    const today = format(new Date(), "yyyy-MM-dd");
    const completions = habit.completions || [];
    const wasCompleted = completions.includes(today);
    const newCompletions = wasCompleted
      ? completions.filter((d) => d !== today)
      : [...completions, today];
    if (!wasCompleted) trackEvent("habit_completion_toggled");
    updateMutation.mutate({ id: habit.id, data: { completions: newCompletions } });
  };

  const handleUpdateCompletions = (id, completions) => {
    updateMutation.mutate({ id, data: { completions } });
  };

  const handleUpdateReminder = (id, reminderData) => {
    updateMutation.mutate({ id, data: reminderData });
  };

  const handleUpdateHabit = (id, data) => {
    updateMutation.mutate({ id, data });
  };

  const handleArchiveHabit = (id) => {
    updateMutation.mutate({ id, data: { archived: true } });
  };

  // "Complete All" writes every not-yet-done habit in one tap, so a
  // misfire silently corrupts the day's real completion record. Rather
  // than block on a confirm dialog for what's usually an intentional,
  // low-risk action, it fires immediately and offers a short Undo
  // window -- each habit's pre-toggle completions array is captured
  // here (habits' state at click time, before today gets appended), so
  // Undo just restores exactly that, not "clear today for everyone".
  const handleCompleteAll = () => {
    const toComplete = habits.filter((h) => !(h.completions || []).includes(today));
    if (toComplete.length === 0) return;

    toComplete.forEach((h) => {
      updateMutation.mutate({ id: h.id, data: { completions: [...(h.completions || []), today] } });
    });

    const toastId = toast(
      <div className="flex items-center justify-between gap-3 w-full">
        <p className="text-sm text-foreground">
          Completed {toComplete.length} habit{toComplete.length !== 1 ? "s" : ""} for today
        </p>
        <button
          className="text-xs font-semibold text-primary hover:underline shrink-0"
          onClick={() => {
            toComplete.forEach((h) => {
              updateMutation.mutate({ id: h.id, data: { completions: h.completions || [] } });
            });
            toast.dismiss(toastId);
          }}
        >
          Undo
        </button>
      </div>,
      { duration: 5000 }
    );
  };

  const RANK_ORDER = ["ember", "flame", "blaze", "inferno", "legend"];

  // Check for rank-up whenever habits or profile change
  useEffect(() => {
    if (!userProfile || !habits.length) return;
    if (rankCheckTimeout.current) clearTimeout(rankCheckTimeout.current);
    rankCheckTimeout.current = setTimeout(() => {
      const score = calculateScore(habits);
      const currentRank = getRank(score);
      const highestKey = userProfile.highest_rank;
      const currentIdx = RANK_ORDER.indexOf(currentRank.key);
      const highestIdx = highestKey ? RANK_ORDER.indexOf(highestKey) : -1;

      if (currentIdx > highestIdx) {
        UserProfile.update(userProfile.id, {highest_rank: currentRank.key}).then(() => {
          setUserProfile((p) => ({ ...p, highest_rank: currentRank.key }));
        });
        if (highestIdx >= 0) setRankUpRank(currentRank);
      }
    }, 2000);

    return () => {
      if (rankCheckTimeout.current) clearTimeout(rankCheckTimeout.current);
    }
  }, [habits, userProfile]);

  const handleApplyFreeze = async (habitId, missedDate) => {
    if (!user?.email) return;
    await applyFreeze(habitId, missedDate);
    queryClient.invalidateQueries({ queryKey: ["habits", user?.email] });
    refreshFreezeState();
  };

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["habits", user?.email] });
  }, [queryClient, user?.email]);

  // Start reminder scheduler
  useEffect(() => {
    startReminderScheduler(
      () => habits,
      (habit) => calculateStreak(habit.completions || [])
    );
  }, [habits]);

  // Start group digest scheduler
  const { data: groupsForDigest = [] } = useQuery({
    queryKey: ["groups", user?.email],
    queryFn: () => user?.email
      ? Group.filter({
          '$or': [
            { created_by: user.email },
            { member_emails: { '$in': [user.email] } }
          ]
        }, "-created_date")
      : [],
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!user?.email) return;
    startDigestScheduler(
      () => groupsForDigest,
      () => habits,
      () => user.email
    );
  }, [groupsForDigest, habits, user]);

  // Weekly summary visibility
  useEffect(() => {
    if (user?.email) {
      setShowSummary(isSummaryVisible(user.email));
      scheduleWeeklySummaryNotif();
    }
  }, [user]);

  // FocusInviteListener (mounted globally in AppLayout.jsx) can only get a
  // user from an arbitrary page (Trends/Social/Settings/...) into a live
  // session by routing them here and handing the already-joined session off
  // via router state -- this is the only page that renders SessionRoom for
  // the "just joined" path. Clear the state immediately after consuming it
  // so it doesn't re-fire on remount or browser back/forward.
  useEffect(() => {
    if (location.state?.joinFocusSession) {
      setActiveSession(location.state.joinFocusSession);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pb-8">
        {/* Header with safe-area top inset */}
        <div
          className="flex items-center justify-between mb-8 pt-8 sm:pt-12"
          style={{ paddingTop: `calc(env(safe-area-inset-top) + 2rem)` }}
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              Habits
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-full px-3"
              onClick={() => setShowFocusModal(true)}
              aria-label="Start focus session"
              title="Start focus session"
            >
              <Timer className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5 rounded-full px-4">
              <Plus className="w-4 h-4" />
              New
            </Button>
          </div>
        </div>

        {/* Stats + freeze indicator + rank */}
        {habits.length > 0 && (
          <div className="mb-8 space-y-3">
            <StatsBar habits={habits} />
            <RankCard score={calculateScore(habits)} />
            {user?.email && (
              <div className="flex justify-end">
                <FreezeIndicator isPro={isPro} freezesRemaining={freezesRemaining} />
              </div>
            )}
          </div>
        )}

        {/* Today tray — consolidates the freeze prompt, focus session
            banner, new-challenge invite, weekly summary, and reminders
            into a single priority-ordered slot (+N more to reveal the
            rest) instead of stacking all of them disclosed at once.
            Each child keeps its own original visibility condition
            internally/via the props below — this wrapper doesn't impose
            a habits.length gate, since FocusSessionBanner and
            ChallengeStartBanner never had one (a brand-new user with no
            habits yet can still get a focus/challenge invite). */}
        {user?.email && (
          <TodayTray
            habits={habits}
            userEmail={user.email}
            frozenHabitIds={new Set(Object.keys(frozenHabits))}
            isPro={isPro}
            freezesRemaining={freezesRemaining}
            onApplyFreeze={handleApplyFreeze}
            onOpenSession={(s) => setActiveSession(s)}
            onFocusInviteJoined={(s) => setActiveSession(s)}
            showSummary={showSummary && habits.length > 0}
            onDismissSummary={() => setShowSummary(false)}
          />
        )}

        {/* Challenge Banner — ongoing status for an active challenge, not
            a notification (no dismiss, persists for the challenge's whole
            duration), so it deliberately stays outside the tray */}
        {user?.email && habits.length > 0 && (
          <div className="mb-4">
            <ChallengeBanner userEmail={user.email} habits={habits} />
          </div>
        )}

        {/* Complete All button */}
        {habits.length > 0 && !habits.every((h) => (h.completions || []).includes(today)) && (
          <div className="mb-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-full px-4 text-muted-foreground hover:text-foreground"
              onClick={handleCompleteAll}
            >
              <CheckCheck className="w-4 h-4" />
              Complete All
            </Button>
          </div>
        )}

        {/* Habit list with pull-to-refresh */}
        {isLoading && !createMutation.isPending ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : habits.length === 0 && !createMutation.isPending ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col items-center text-center py-20 px-4"
          >
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shadow-inner">
                <span className="text-5xl leading-none select-none">🔥</span>
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent/30 flex items-center justify-center">
                <span className="text-lg leading-none">✨</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
              Your streak starts today
            </h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-xs leading-relaxed">
              Add your first habit and start building momentum.
            </p>
            <Button
              onClick={() => setShowAdd(true)}
              size="lg"
              className="rounded-full px-8 gap-2 shadow-md hover:shadow-lg transition-shadow"
            >
              <Plus className="w-5 h-5" />
              Add your first habit
            </Button>
          </motion.div>
        ) : (
          <PullToRefresh onRefresh={handleRefresh}>
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {habits.map((habit) => (
                  <motion.div
                    key={habit.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ duration: 0.25 }}
                  >
                    <HabitCard
                      habit={habit}
                      onToggleToday={handleToggleToday}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onUpdateCompletions={handleUpdateCompletions}
                      onUpdateReminder={handleUpdateReminder}
                      onApplyFreeze={handleApplyFreeze}
                      onUpdate={handleUpdateHabit}
                      onArchive={handleArchiveHabit}
                      userEmail={user?.email}
                      isPro={isPro}
                      isToggling={pendingHabitIds.has(habit.id)}
                      frozenDate={frozenHabits[habit.id] || null}
                      freezesRemaining={freezesRemaining}
                      />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </PullToRefresh>
        )}

        <AddHabitDialog open={showAdd} onOpenChange={setShowAdd} onAdd={(data) => createMutation.mutateAsync(data)} />
        </div>
        <RankUpModal rank={rankUpRank} onClose={() => setRankUpRank(null)} />
        <StartFocusModal
          open={showFocusModal}
          onOpenChange={setShowFocusModal}
          userEmail={user?.email}
          userName={user?.full_name || user?.email?.split("@")[0]}
          onSessionCreated={(s) => setActiveSession(s)}
        />
        {activeSession && (
        <SessionRoom
          session={activeSession}
          userEmail={user?.email}
          userName={user?.full_name || user?.email?.split("@")[0]}
          onClose={() => setActiveSession(null)}
        />
        )}
        </div>
        );
}