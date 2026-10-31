import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ArrowLeft, Medal } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Habit, Group, UserBadge, UserProfile } from "@/api/entities";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { cn, getRank, calculateScore, calculateStats, scoreFromParts, witnessFactor } from "@/lib/utils";
import { evaluateBadges, STREAK_BADGE_IDS, getStreakBadgeEarnedDate } from "@/lib/badgeDefinitions";
import { hasFreezeEverBeenUsed } from "@/lib/freezeService";
import BadgeCelebrationModal from "@/components/badges/BadgeCelebrationModal";
import { motion } from "framer-motion";
import { format } from "date-fns";
import ScoreBreakdownSheet from "@/components/rank/ScoreBreakdownSheet";

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

// How many public profiles the percentile is computed from. Large enough
// for "top N%" to mean something, small enough to be a fixed cost as the
// user base grows.
const PERCENTILE_SAMPLE = 500;

const BadgeCard = React.memo(function BadgeCard({ badge, isNew }) {
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
});

export default function Badges() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [celebrationBadge, setCelebrationBadge] = useState(null);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
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

  // hasFreezeEverBeenUsed is async -- calling it directly here (as this
  // used to) never awaits the promise, so freezeEverUsed was always a
  // truthy Promise object regardless of the real answer, which fed
  // evaluateBadges() an always-true "comeback_kid" freeze signal for any
  // logged-in user. Not a security issue (award_badge's RPC recomputes
  // this itself from streak_freezes server-side before persisting
  // anything), but it did mean this page could show/attempt to award
  // Comeback Kid based on a value that was never actually checked.
  const { data: freezeEverUsed = false } = useQuery({
    queryKey: ["freeze-ever-used", user?.email],
    queryFn: () => hasFreezeEverBeenUsed(user.email),
    enabled: !!user?.email,
  });

  // Build a map of badge_id -> earned_date from persisted records
  const persistedMap = useMemo(() => {
    const map = {};
    persistedBadges.forEach((pb) => { map[pb.badge_id] = pb.earned_date; });
    return map;
  }, [persistedBadges]);

  const today = format(new Date(), "yyyy-MM-dd");

  // Merge: a badge is earned if EITHER current evaluation says so OR it's
  // persisted. Earned state never reverts — only locked → earned
  // transitions allowed. Memoized so BadgeCard (React.memo below) actually
  // skips re-rendering when unrelated state (the celebration modal,
  // newlyEarnedIds) changes but the badge data itself hasn't.
  const merged = useMemo(() => {
    const evaluated = evaluateBadges(habits, allMyGroups, user?.email, freezeEverUsed);
    return evaluated.map((b) => {
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
  }, [habits, allMyGroups, user?.email, freezeEverUsed, persistedMap]);

  const earned = useMemo(() => merged.filter((b) => b.earned), [merged]);
  const locked = useMemo(() => merged.filter((b) => !b.earned), [merged]);

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
          // The celebration above (setNewlyEarnedIds / setCelebrationBadge)
          // has already fired by the time this runs, so a silent failure
          // here means the user is congratulated for a badge that never
          // persists -- and persistedBadges is the source of truth for
          // "earned", so on the next load it quietly goes back to locked.
          //
          // The old handler was `if (error || !data?.success) return;` with
          // no .catch at all: a server rejection AND a network rejection
          // both vanished.
          //
          // The retry claim in the toast is real, not reassurance: this
          // effect re-runs on [habits, allMyGroups, persistedBadges] and
          // only skips ids already in persistedMap, so an unpersisted badge
          // is attempted again on the next pass.
          supabase.rpc("award_badge", { p_badge_id: badgeId, p_today: today })
            .then(({ data, error }) => {
              if (error || !data?.success) {
                console.error("Badges: award_badge did not persist", badgeId, error || data);
                toast.error("Couldn't save that badge yet — we'll try again.", { duration: 3500 });
                return;
              }
              queryClient.invalidateQueries({ queryKey: ["user-badges", user.email] });
            })
            // typecheck flags this .catch as missing from PromiseLike --
            // PostgrestBuilder declares `implements PromiseLike` and types
            // then() as returning PromiseLike. It works: then() delegates to
            // a real Promise (PostgrestBuilder.ts:465), so .catch here is
            // called on a native Promise. Kept as a trailing .catch rather
            // than a two-arg then(ok, err), which would be type-clean but
            // would NOT catch a throw inside the success handler. Same
            // typing artifact already present at GroupDashboard.jsx:297.
            .catch((err) => {
              console.error("Badges: award_badge request failed", badgeId, err);
              toast.error("Couldn't save that badge yet — we'll try again.", { duration: 3500 });
            });
        }
      });
    }

    prevEarnedIds.current = currentEarnedIds;
  }, [habits, allMyGroups, persistedBadges]);

  // The profiles query comes FIRST because the rank below now depends on
  // it: the viewer's own witness multiplier is read from the same
  // ["user-profiles"] result the peer comparison uses, so both sides of
  // "top X%" go through one definition. Declared after the rank, it was a
  // temporal dead zone -- a ReferenceError on every render, which
  // typecheck caught as TS2448.
  // Bounded. This was an unbounded fetch of every readable profile, run
  // to produce a single percentile. 500 is a sample large enough for that
  // number to mean something and small enough to stay a fixed cost; the
  // query key stays ["user-profiles"] so it shares cache with Social.
  const { data: allProfiles = [] } = useQuery({
    queryKey: ["user-profiles"],
    queryFn: () => UserProfile.list("-best_streak", PERCENTILE_SAMPLE),
  });

  // Compute rank -- calculateScore/getRank, same shared formula RankCard
  // and the leaderboards use, instead of a separate inline copy.
  const myProfileRow = allProfiles.find((p) => p.created_by === user?.email);
  const myWitness = witnessFactor(myProfileRow?.witness_slots);
  const myScore = calculateScore(habits, myWitness);
  const myRank = getRank(myScore);
  const { nextRank } = myRank;
  const progressPct = nextRank
    ? Math.min(((myScore - myRank.minScore) / (nextRank.minScore - myRank.minScore)) * 100, 100)
    : 100;

  const totalUsers = allProfiles.length;
  const usersBelow = allProfiles.filter((p) => {
    const s = scoreFromParts(p.rolling_best_streak_90, p.consistency_score, witnessFactor(p.witness_slots));
    return s < myScore;
  }).length;

  // This line used to greet every new user with "You are in the top 100%
  // of Strk users". At myScore 0 nobody scores below you, so usersBelow is
  // 0 and the percentage is 100 -- the app's only bragging surface opening
  // by telling someone they are last, in the grammar of a compliment.
  //
  // Three separate corrections:
  //
  //   myScore > 0 && usersBelow > 0 -- a percentile needs somebody to be
  //   a percentile OF. Below that it is not a modest claim, it is a
  //   meaningless one, so the line is withheld rather than softened.
  //
  //   Math.min(..., 99) -- "top 100%" is never a thing worth printing even
  //   when the arithmetic produces it.
  //
  //   "who share progress", not "of Strk users". allProfiles comes from
  //   UserProfile.list, which RLS limits to rows with is_public = true, so
  //   the denominator is people who have Progress sharing on -- not the
  //   user base. Social.jsx documents removing exactly this conflation
  //   from the leaderboard for being wrong; the same claim was still here,
  //   and in a product with GDPR/POPIA positioning a sentence about "all
  //   Strk users" is a statement about other people's data.
  const canRank = myScore > 0 && usersBelow > 0 && totalUsers > 5;
  const topPct = canRank
    ? Math.min(Math.round(((totalUsers - usersBelow) / totalUsers) * 100), 99)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/Dashboard">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back to Dashboard">
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

        {/* Rank Showcase. The whole card is the affordance for the
            breakdown, because the score is the thing users cannot explain
            and this is the screen they come to for it. */}
        <button
          type="button"
          onClick={() => setShowScoreBreakdown(true)}
          aria-label={`${myRank.title}, ${myScore} points. See what your score is made of.`}
          className="w-full mb-6 p-5 rounded-2xl border bg-card text-center outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="text-6xl mb-2 leading-none" aria-hidden="true">{myRank.emoji}</div>
          <h2 className="text-2xl font-extrabold text-foreground tracking-tight mb-0.5">{myRank.title}</h2>
          <p className="text-xs text-muted-foreground mb-3">{myScore} points</p>
          <div
            role="progressbar"
            aria-valuemin={myRank.minScore}
            aria-valuemax={nextRank ? nextRank.minScore : myRank.minScore}
            aria-valuenow={myScore}
            aria-valuetext={
              nextRank
                ? `${myScore} points, ${nextRank.minScore - myScore} to ${nextRank.title}`
                : `${myScore} points, top of the ladder`
            }
            className="h-2 rounded-full bg-muted overflow-hidden mb-1.5"
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {nextRank
              ? `${nextRank.minScore - myScore} points to ${nextRank.title}`
              : "Top of the ladder"}
          </p>
          {topPct !== null && (
            <p className="text-xs font-semibold text-primary">
              Top {topPct}% of Strk users who share progress
            </p>
          )}
        </button>

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
      {/* Same component and the same inputs as Dashboard's, so the two
          screens cannot explain one score two ways. */}
      <ScoreBreakdownSheet
        open={showScoreBreakdown}
        onOpenChange={setShowScoreBreakdown}
        {...calculateStats(habits, new Date(), myWitness)}
        witnessSlots={myProfileRow?.witness_slots}
        rankReachedAt={myProfileRow?.rank_reached_at}
      />
    </div>
  );
}