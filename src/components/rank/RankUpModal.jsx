import React, { useEffect } from "react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { prefersReducedMotion } from "@/lib/utils";
import RankMark from "@/components/rank/RankMark";

/**
 * The one celebration this system has, and it used to teach nothing.
 *
 * It can fire at most four times in a user's life -- there are five tiers
 * -- and it arrives at the single moment somebody is most receptive to
 * learning how the score works. It spent that moment on an emoji and a
 * five-second fuse: no score, no threshold crossed, no next target, and no
 * reference back to the action that caused it.
 *
 * Three fixes, in order of how much they mattered:
 *
 *   The number is in it. "You are now Blaze" states a label; "160 points,
 *   50 to Inferno" states where they are and what is next.
 *
 *   No auto-dismiss. The old `setTimeout(onClose, 5000)` was
 *   unconditional, so it fired while the user was still inside the OS
 *   share sheet -- they returned to find the celebration gone, with no way
 *   to see it again. That is also a WCAG 2.2.1 (Timing Adjustable) failure
 *   on a dialog containing interactive controls: a time limit has to be
 *   adjustable, extendable or absent, and there were two buttons already
 *   providing a manual way out. The timer removed, not lengthened.
 *
 *   Both share paths handle rejection. navigator.share rejects with
 *   AbortError when the sheet is dismissed, which was an unhandled
 *   rejection on an ordinary user action, and clipboard.writeText rejects
 *   without a user gesture or permission -- silently, so the fallback
 *   claimed a copy that never happened. Social.jsx documents having fixed
 *   exactly these two patterns; this file never got them.
 */
export default function RankUpModal({ rank, score, rollingBest, onClose }) {
  useEffect(() => {
    if (!rank) return;
    // src/index.css's reduced-motion block only reaches CSS animations
    // and transitions -- a canvas-confetti burst is JavaScript drawing
    // to a canvas, which is exactly why utils.js exports
    // prefersReducedMotion(). SessionRoom has used it since the focus
    // session work; these surfaces never did.
    //
    // The screen still celebrates -- the copy, the icon and the layout
    // carry the moment -- so skipping the burst costs it nothing it
    // needed.
    if (!prefersReducedMotion()) {
      confetti({ particleCount: 160, spread: 90, origin: { y: 0.5 } });
    }
  }, [rank]);

  const nextRank = rank?.nextRank;

  const handleShare = async () => {
    // A human fact, not a product noun. The old payload was "I just ranked
    // up to 🔥 Flame on Strk! 🔥" -- two flame emoji, and "Flame" means
    // nothing to a recipient who does not use Strk. A day count is
    // something a friend can actually react to, which is the entire point
    // of sharing it on this product.
    const streakPart = rollingBest > 0
      ? ` — ${rollingBest} ${rollingBest === 1 ? "day" : "days"} running`
      : "";
    const text = `I just reached ${rank.title} on Strk${streakPart}. ${window.location.origin}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Strk", text });
      } catch (err) {
        // Dismissing the share sheet rejects with AbortError. That is the
        // user changing their mind, not a failure, so it must not surface
        // as one -- but it must still be caught.
        if (err?.name !== "AbortError") {
          toast.error("Couldn't open the share sheet.", { duration: 4000 });
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied — send it to a friend.");
    } catch {
      toast.error("Couldn't copy that. Long-press the address bar to copy the link instead.", {
        duration: 5000,
      });
    }
  };

  return (
    <Dialog open={!!rank} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm rounded-3xl p-8 text-center gap-0">
        {rank && (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Rank Up!
            </p>
            {/* The drawn mark, not an emoji: a screen reader announcing
                "high voltage" told nobody their tier, and the glyphs
                contradicted the fire names. Decorative — the title below
                carries the meaning. */}
            <div className="flex justify-center mb-4">
              <RankMark rankKey={rank.key} size={88} />
            </div>
            <DialogTitle className="text-3xl font-extrabold tracking-tight mb-2">
              <span className="text-foreground">You are now </span>
              <span className="text-primary">{rank.title}</span>
            </DialogTitle>

            {/* The earned number and the next target. Without these the
                modal is the only place in the product that could have
                explained the score and didn't. */}
            <p className="text-sm text-muted-foreground mb-1 tabular-nums">
              {score} points
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              {nextRank
                ? `${nextRank.minScore - score} more to reach ${nextRank.title}`
                : "Top of the ladder"}
            </p>

            {/* Names the rank and the score, which the old sr-only text
                omitted -- it said only "You've reached a new rank in
                Strk", so the announcement carried none of the content. */}
            <DialogDescription className="sr-only">
              {`You are now ${rank.title} with ${score} points.`}
              {nextRank
                ? ` ${nextRank.minScore - score} more points to reach ${nextRank.title}.`
                : " This is the top of the ladder."}
            </DialogDescription>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors min-h-11"
              >
                Share
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl bg-muted text-foreground py-3 text-sm font-semibold hover:bg-muted/80 transition-colors min-h-11"
              >
                Continue
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
