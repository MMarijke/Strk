import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Medal } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Habit, Group, UserBadge, UserProfile } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { cn, getRank, calculateScore } from "@/lib/utils";
import { evaluateBadges, STREAK_BADGE_IDS, getStreakBadgeEarnedDate } from "@/lib/badgeDefinitions";
import { hasFreezeEverBeenUsed } from "@/lib/freezeService";
import BadgeCelebrationModal from "@/components/badges/BadgeCelebrationModal";
import { motion } from "framer-motion";
import { format } from "date-fns";
import RankUpModal from "@/components/rank/RankUpModal";

function ProgressBar({ current, total }) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
      <div
        className="h-full rounded-full bg-primary/60 transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BadgeCard({ badge, isNew }) {
  return (
    <motion.div
      initial={isNew ? { scale: 0.9, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <Card
        className={cn(
          "border p-4 transition-all duration-300 relative overflow-hidden",
          badge.earned
            ? cn("shadow-md", badge.border, isNew && "shadow-lg")
            : "border-border opacity-55"
        )}
      >
        {/* Shimmer for newly earned */}
        {badge.earned && isNew && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "200%" }}
              transition={{ duration: 1.2, delay: 0.2, ease: "easeInOut" }}
              className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
            />
          </div>
        )}

        <div className="flex items-start gap-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 transition-all",
            badge.earned ? cn(badge.color, isNew && "shadow-md") : "bg-muted grayscale"
          )}>
            {badge.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-bold text-sm text-foreground">{badge.name}</h3>
              {badge.earned ? (
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", badge.color)}>
                  Earned ✓
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Locked
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-1">{badge.description}</p>

            {badge.earned && (
              <p className="text-[10px] text-muted-foreground/70 mb-1">
                {badge.earned_date === "recently"
                  ? "Earned recently"
                  : badge.earned_date
                    ? `Earned ${format(new Date(badge.earned_date), "MMM d, yyyy")}`
                    : "Earned recently"}
              </p>
            )}

            {!badge.earned && badge.progress && (
              <div>
                <p className="text-[10px] text-muted-foreground">{badge.progress.label}</p>
                <ProgressBar current={badge.progress.current} total={badge.progress.total} />
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export default function Badges() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [celebrationBadge, setCelebrationBadge] = useState(null);
  const [rankUpRank, setRankUpRank] = useState(null);
  const prevEarnedIds = useRef(null);
  const [newlyEarnedIds, setNewlyEarnedIds] = useState(new Set());

  const { data: habits = [] } = useQuery({
    queryKey: ["habits", user?.email],
    queryFn: () => user?.email
      ? Habit.filter({ created_by: user.email }, "-created_date")
      : [],
    enabled: !!user?.email,
  });

  const { data: allMyGroups = [] } = useQuery({
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
  });

  // Load persisted badge records
  const { data: persistedBadges = [] } = useQuery({
    queryKey: ["user-badges", user?.email],
    queryFn: () => user?.email
      ? UserBadge.filter({ user_email: user.email })
      : [],
    enabled: !!user?.email,
  });

  const freezeEverUsed = user?.email ? hasFreezeEverBeenUsed(user.email) : false;

  // Build a map of badge_id -> earned_date from persisted records
  const persistedMap = {};
  persistedBadges.forEach((pb) => { persistedMap[pb.badge_id] = pb.earned_date; });

  // Evaluate current state from habit data
  const evaluated = evaluateBadges(habits, allMyGroups, user?.email, freezeEverUsed);

  // Merge: a badge is earned if EITHER current evaluation says so OR it's persisted
  // Earned state never reverts — only locked → earned transitions allowed
  const today = format(new Date(), "yyyy-MM-dd");
  const merged = evaluated.map((b) => {
    const persistedDate = persistedMap[b.badge_id] || persistedMap[b.id];
    if (b.earned || persistedDate) {
      let earnedDate = persistedDate; // always prefer what's already stored
      if (!earnedDate) {
        // First time earning — calculate retroactive date for streak badges
        if (STREAK_BADGE_IDS.has(b.id) && b.streakDays) {
          earnedDate = getStreakBadgeEarnedDate(habits, b.streakDays) || "recently";
        } else {
          earnedDate = "recently";
        }
      }
      return { ...b, earned: true, earned_date: earnedDate };
    }
    return b;
  });

  const earned = merged.filter((b) => b.earned);
  const locked = merged.filter((b) => !b.earned);

  // Detect newly earned badges, persist them, trigger celebration
  useEffect(() => {
    if (!user?.email || persistedBadges === undefined) return;

    const currentEarnedIds = new Set(merged.filter((b) => b.earned).map((b) => b.id));

    if (prevEarnedIds.current === null) {
      prevEarnedIds.current = currentEarnedIds;
      return;
    }

    const newIds = [...currentEarnedIds].filter((id) => !prevEarnedIds.current.has(id));

    if (newIds.length > 0) {
      setNewlyEarnedIds(new Set(newIds));
      const badge = merged.find((b) => b.id === newIds[0]);
      if (badge) setCelebrationBadge(badge);

      // Persist each newly earned badge (skip ones already in DB, never overwrite).
      // Routed through the award_badge() RPC rather than a direct
      // UserBadge.create() -- eligibility is recomputed and verified
      // server-side from the caller's real habits/groups/streak_freezes,
      // not trusted from this client-side evaluateBadges() pass, which now
      // only drives the UI (progress bars, locked/earned display).
      newIds.forEach((badgeId) => {
        if (!persistedMap[badgeId]) {
          supabase.rpc("award_badge", { p_badge_id: badgeId, p_today: today }).then(({ data, error }) => {
            if (error || !data?.success) return;
            queryClient.invalidateQueries({ queryKey: ["user-badges", user.email] });
          });
        }
      });
    }

    prevEarnedIds.current = currentEarnedIds;
  }, [habits, allMyGroups, persistedBadges]);

  // Compute rank -- calculateScore/getRank, same shared formula RankCard
  // and the leaderboards use, instead of a separate inline copy.
  const myScore = calculateScore(habits);
  const myRank = getRank(myScore);
  const { nextRank } = myRank;
  const progressPct = nextRank
    ? Math.min(((myScore - myRank.minScore) / (nextRank.minScore - myRank.minScore)) * 100, 100)
    : 100;

  // Top X% calculation
  const { data: allProfiles = [] } = useQuery({
    queryKey: ["user-profiles"],
    queryFn: () => UserProfile.list("-best_streak"),
  });
  const totalUsers = allProfiles.length;
  const usersBelow = allProfiles.filter((p) => {
    const s = (p.best_streak || 0) * 2 + (p.consistency_score || 0);
    return s < myScore;
  }).length;
  const topPct = totalUsers > 5 ? Math.round(((totalUsers - usersBelow) / totalUsers) * 100) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/Dashboard">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <Medal className="w-5 h-5 text-primary" /> Your Badges
            </h1>
            <p className="text-sm text-muted-foreground">
              {earned.length} of {merged.length} earned
            </p>
          </div>
        </div>

        {/* Rank Showcase */}
        <div className="mb-6 p-5 rounded-2xl border bg-card text-center">
          <div className="text-6xl mb-2 leading-none">{myRank.emoji}</div>
          <h2 className="text-2xl font-extrabold text-foreground tracking-tight mb-0.5">{myRank.title}</h2>
          <p className="text-xs text-muted-foreground mb-3">{myScore} points</p>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {nextRank
              ? `${nextRank.minScore - myScore} points to ${nextRank.emoji} ${nextRank.title}`
              : "Maximum rank reached 👑"}
          </p>
          {topPct !== null && (
            <p className="text-xs font-semibold text-primary">You are in the top {topPct}% of Strk users</p>
          )}
        </div>

        {/* Progress summary */}
        <div className="mb-6 p-4 bg-primary/5 rounded-2xl border border-primary/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overall Progress</span>
            <span className="text-sm font-bold text-primary">{earned.length} / {merged.length}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${merged.length ? (earned.length / merged.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Earned section */}
        {earned.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Earned ({earned.length})
            </h2>
            <div className="space-y-3">
              {earned.map((b) => (
                <BadgeCard key={b.id} badge={b} isNew={newlyEarnedIds.has(b.id)} />
              ))}
            </div>
          </div>
        )}

        {/* Locked section */}
        {locked.length > 0 && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Locked ({locked.length})
            </h2>
            <div className="space-y-3">
              {locked.map((b) => (
                <BadgeCard key={b.id} badge={b} isNew={false} />
              ))}
            </div>
          </div>
        )}
      </div>

      <BadgeCelebrationModal badge={celebrationBadge} onClose={() => setCelebrationBadge(null)} />
      <RankUpModal rank={rankUpRank} onClose={() => setRankUpRank(null)} />
    </div>
  );
}