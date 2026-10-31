import React from "react";
import { Flame } from "lucide-react";
import { cn, RANK_ORDER } from "@/lib/utils";

/**
 * One module owning how a tier looks, everywhere.
 *
 * Before this, DashboardSummary held a RANK_STYLES lookup keyed on a
 * `color` string ("green", "orange", "yellow", "red", "gold") that no
 * other file read, and Badges rendered the same tier with a plain border
 * and a bg-primary bar — so one tier looked like two different things on
 * two screens. Four of the five colour values existed to serve exactly
 * one card.
 *
 * The emoji are gone too. Ember was 🌱, a seedling, in a flame-branded
 * product; Blaze was ⚡, a lightning bolt; the old top tier was 👑, a
 * crown. Three of five abandoned the fire metaphor the NAMES establish,
 * and a screen reader announced "seedling" and "high voltage" where the
 * tier name belonged. One drawn mark at five intensities replaces them:
 * the same lucide Flame at the same stroke width, with the tier's own
 * token carrying the heat. Colour alone does the escalating, so the mark
 * never reads as two different icon treatments.
 */

/**
 * Complete literal class strings per tier, never built by interpolation.
 *
 * Tailwind's JIT scans source text, so `bg-[hsl(var(--rank-3))]` is found
 * only because it appears verbatim here. A constructed
 * `bg-[hsl(var(--rank-${n}))]` would compile, ship, and render unstyled —
 * the kind of break that looks like a CSS mistake rather than a missing
 * class.
 */
const TIER_STYLES = {
  ember: {
    text: "text-[hsl(var(--rank-1))]",
    border: "border-[hsl(var(--rank-1)/0.4)]",
    tint: "from-[hsl(var(--rank-1)/0.15)]",
    bar: "bg-[hsl(var(--rank-1))]",
  },
  flame: {
    text: "text-[hsl(var(--rank-2))]",
    border: "border-[hsl(var(--rank-2)/0.4)]",
    tint: "from-[hsl(var(--rank-2)/0.15)]",
    bar: "bg-[hsl(var(--rank-2))]",
  },
  blaze: {
    text: "text-[hsl(var(--rank-3))]",
    border: "border-[hsl(var(--rank-3)/0.4)]",
    tint: "from-[hsl(var(--rank-3)/0.15)]",
    bar: "bg-[hsl(var(--rank-3))]",
  },
  inferno: {
    text: "text-[hsl(var(--rank-4))]",
    border: "border-[hsl(var(--rank-4)/0.4)]",
    tint: "from-[hsl(var(--rank-4)/0.15)]",
    bar: "bg-[hsl(var(--rank-4))]",
  },
  wildfire: {
    text: "text-[hsl(var(--rank-5))]",
    border: "border-[hsl(var(--rank-5)/0.45)]",
    tint: "from-[hsl(var(--rank-5)/0.2)]",
    bar: "bg-[hsl(var(--rank-5))]",
  },
};

/**
 * The border, tint and bar classes for a tier.
 *
 * Falls back to the first tier for an unknown key rather than returning
 * undefined: a stale `highest_rank` string should render the bottom of the
 * ladder, not crash a card on `style.border`.
 */
export function rankStyle(rankKey) {
  return TIER_STYLES[rankKey] ?? TIER_STYLES[RANK_ORDER[0]];
}

/**
 * The tier mark. Decorative by default — the tier NAME is what carries
 * meaning, and every call site renders it alongside this.
 *
 * `strokeWidth` is fixed at 2.25 across all five so the family stays
 * coherent; only the colour escalates.
 */
export default function RankMark({
  rankKey,
  className = undefined,
  size = 24,
  decorative = true,
  // Only read when decorative is false. Defaulted so the prop is optional
  // in the type as well as in intent -- undefaulted, TypeScript treats it
  // as required and every one of the six call sites reports TS2741.
  title = undefined,
}) {
  const style = rankStyle(rankKey);
  return (
    <Flame
      className={cn(style.text, className)}
      style={{ width: size, height: size }}
      strokeWidth={2.25}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : title}
      role={decorative ? undefined : "img"}
    />
  );
}
