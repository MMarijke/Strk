import React from "react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check } from "lucide-react";
import { cn, RANKS, WITNESS_SLOTS, WITNESS_SLOT_VALUE, getRank } from "@/lib/utils";
import RankMark from "@/components/rank/RankMark";

/**
 * What the score is made of, in the user's own numbers.
 *
 * This exists because the formula was legible nowhere. It was printed in
 * two places, on neither of the two surfaces that show the score
 * prominently, and the five-tier ladder was never rendered at all -- so a
 * user could not predict how any action moved their score, and could not
 * discover the top tier existed without reaching it. A motivational
 * mechanic nobody understands motivates nobody.
 *
 * Two deliberate choices about what goes in it:
 *
 * The user's OWN arithmetic, not the formula. "Best streak x 2 +
 * Consistency %" is a definition; "day 48 x 2 = 96" is an answer. The
 * abstract version was already on Social and taught nobody anything.
 *
 * The unlit witness rows are the most valuable copy here. Each one names a
 * social feature the user has not used, with what it would be worth,
 * which makes the tier card the product's own route into its group
 * mechanics rather than a scoreboard bolted on top of them.
 */

/** One line of the sum. Label left, working middle, value right. */
/** `working` is optional: the subtotal and total lines have no sum to show. */
function Row({ label, working = null, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className={cn("text-sm", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
      </p>
      <div className="flex items-baseline gap-2 shrink-0">
        {working && (
          <span className="text-xs text-muted-foreground tabular-nums">{working}</span>
        )}
        <span
          className={cn(
            "tabular-nums",
            strong ? "text-base font-bold text-foreground" : "text-sm font-medium text-foreground"
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * "Reached 12 Mar", or "Reached" with no date for a tier earned before
 * rank_reached_at existed, or nothing for a tier never reached.
 *
 * Reached-ness is inferred from the score rather than from the map, so a
 * tier the user is past but has no stored date for is still shown as
 * earned. The map only ever adds precision.
 */
function reachedLabel(key, reached, isCurrent, score) {
  const tier = RANKS.find((r) => r.key === key);
  const earned = isCurrent || (tier && score >= tier.minScore);
  if (!earned) return null;

  const stamp = reached[key];
  if (!stamp) return "Reached";

  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return "Reached";
  return `Reached ${format(when, "d MMM yyyy")}`;
}

export default function ScoreBreakdownSheet({
  open,
  onOpenChange,
  score,
  base,
  rollingBest,
  consistency,
  witnessSlots,
  rankReachedAt,
}) {
  const rank = getRank(score);
  const { nextRank } = rank;
  const slots = witnessSlots && typeof witnessSlots === "object" ? witnessSlots : {};
  const lit = WITNESS_SLOTS.filter((s) => slots[s.key] === true).length;
  const reached = rankReachedAt && typeof rankReachedAt === "object" ? rankReachedAt : {};
  const multiplier = 1 + lit * WITNESS_SLOT_VALUE;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl p-0 flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-8 space-y-6">
          <SheetHeader className="mb-1">
            <SheetTitle>Your score</SheetTitle>
          </SheetHeader>

          {/* The sum */}
          <div className="space-y-3">
            <Row
              label="Current form"
              working={`${rollingBest} ${rollingBest === 1 ? "day" : "days"} × 2`}
              value={rollingBest * 2}
            />
            {/* Named "current form" rather than "streak" on purpose: it is
                the longest run in the last 90 days, which is not the same
                as the live streak and not the same as the all-time best
                shown as Peak elsewhere. Three different numbers would be
                three different words. */}
            <p className="text-xs text-muted-foreground -mt-1">
              Your longest run in the last 90 days
            </p>

            <Row label="Consistency" working={`${consistency}%`} value={consistency} />
            <p className="text-xs text-muted-foreground -mt-1">
              How much of each habit you've kept, since you started it or over the last 30 days
            </p>

            <div className="h-px bg-border" aria-hidden="true" />

            <Row label="Subtotal" value={base} />
            <Row
              label="Witnessed"
              working={`${lit} of ${WITNESS_SLOTS.length}`}
              value={`× ${multiplier.toFixed(1)}`}
            />

            <div className="h-px bg-border" aria-hidden="true" />

            <Row label={rank.title} value={`${score} points`} strong />
          </div>

          {/* Witness slots */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Being witnessed
            </h3>
            <p className="text-xs text-muted-foreground">
              Each of these adds {Math.round(WITNESS_SLOT_VALUE * 100)}% to your score. Progress is
              worth more when someone sees it.
            </p>
            <ul className="space-y-2">
              {WITNESS_SLOTS.map((slot) => {
                const on = slots[slot.key] === true;
                return (
                  <li key={slot.key} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                        on ? "bg-primary border-primary" : "border-border"
                      )}
                      aria-hidden="true"
                    >
                      {on && <Check className="w-3 h-3 text-primary-foreground" />}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          on ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {slot.label}
                        <span className="sr-only">{on ? " — earned" : " — not yet earned"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{slot.hint}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The ladder */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              The ladder
            </h3>
            <ul className="space-y-1">
              {RANKS.map((r) => {
                const here = r.key === rank.key;
                return (
                  <li
                    key={r.key}
                    aria-current={here ? "true" : undefined}
                    className={cn(
                      "flex items-baseline justify-between gap-3 rounded-lg px-3 py-2",
                      here ? "bg-primary/10" : ""
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {/* The mark per row is what makes the ramp legible
                          AS a ramp: five tiers in one monotone
                          progression read as an escalation here, where
                          five unrelated palette picks read as a legend. */}
                      <RankMark rankKey={r.key} size={16} className="mt-0.5 shrink-0" />
                      <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm",
                          here ? "font-semibold text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {r.title}
                        {here && <span className="sr-only"> — you are here</span>}
                      </p>
                      {/* When this tier was first reached. The whole reason
                          rank_reached_at exists: RankUpModal can fire at
                          most four times in a user's life and a missed one
                          left no trace at all, so the moment was
                          unrecoverable. A tier reached before the column
                          existed has no date and simply says so rather
                          than being given an invented one. */}
                      {reachedLabel(r.key, reached, here, score) && (
                        <p className="text-[11px] text-muted-foreground">
                          {reachedLabel(r.key, reached, here, score)}
                        </p>
                      )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {/* maxScore finally has a reader. It was declared on
                          every tier and used by nothing, which is why the
                          ladder could not be rendered. */}
                      {Number.isFinite(r.maxScore)
                        ? `${r.minScore}–${r.maxScore}`
                        : `${r.minScore}+`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {nextRank ? (
              <p className="text-xs text-muted-foreground">
                {nextRank.minScore - score} more to reach {nextRank.title}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                You're at the top of the ladder.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
