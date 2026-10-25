import React, { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { prefersReducedMotion } from "@/lib/utils";

export default function RankUpModal({ rank, onClose }) {
  const timerRef = useRef(null);

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
    // The auto-close timer is deliberately OUTSIDE the guard: it is how the
    // modal dismisses itself, not decoration, so skipping it would leave a
    // reduced-motion user stuck on the modal until they close it by hand.
    timerRef.current = setTimeout(onClose, 5000);
    return () => clearTimeout(timerRef.current);
  }, [rank]);

  const handleShare = () => {
    const text = `I just ranked up to ${rank.emoji} ${rank.title} on Strk! 🔥 ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({ title: "Strk Rank Up!", text });
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <Dialog open={!!rank} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm rounded-3xl p-8 text-center gap-0">
        {rank && (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Rank Up!</p>
            <div className="text-8xl mb-4 leading-none">{rank.emoji}</div>
            <DialogTitle className="text-3xl font-extrabold tracking-tight mb-6">
              <span className="text-foreground">You are now </span>
              <span className="text-primary">{rank.title}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              You've reached a new rank in Strk.
            </DialogDescription>

            <div className="flex gap-3">
              <button
                onClick={handleShare}
                className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                🔗 Share
              </button>
              <button
                onClick={onClose}
                className="flex-1 rounded-xl bg-muted text-foreground py-3 text-sm font-semibold hover:bg-muted/80 transition-colors"
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
