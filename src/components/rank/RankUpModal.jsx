import React, { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

export default function RankUpModal({ rank, onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!rank) return;
    // Confetti burst
    confetti({ particleCount: 160, spread: 90, origin: { y: 0.5 } });
    timerRef.current = setTimeout(onClose, 5000);
    return () => clearTimeout(timerRef.current);
  }, [rank]);

  if (!rank) return null;

  const handleShare = () => {
    const text = `I just ranked up to ${rank.emoji} ${rank.title} on Strk! 🔥 ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({ title: "Strk Rank Up!", text });
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-3xl p-8 mx-6 max-w-sm w-full text-center shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Rank Up!</p>
        <div className="text-8xl mb-4 leading-none">{rank.emoji}</div>
        <h2 className="text-3xl font-extrabold text-foreground tracking-tight mb-1">You are now</h2>
        <h3 className="text-3xl font-extrabold text-primary mb-6">{rank.title}</h3>

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
      </div>
    </div>
  );
}