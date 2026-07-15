import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

export default function BadgeCelebrationModal({ badge, onClose }) {
  useEffect(() => {
    if (!badge) return;
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#a78bfa", "#f59e0b", "#34d399", "#f472b6"] });
  }, [badge]);

  const handleShare = () => {
    const text = `I just earned the "${badge.name}" badge on HabitTracker! ${badge.emoji} 🏆`;
    navigator.clipboard.writeText(text);
  };

  return (
    <AnimatePresence>
      {badge && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="bg-card rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <motion.div
              animate={{ scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className={cn(
                "w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mx-auto mb-5 shadow-lg",
                badge.color
              )}
            >
              {badge.emoji}
            </motion.div>

            <div className="mb-1">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Badge Earned!</span>
            </div>
            <h2 className="text-2xl font-extrabold text-foreground mb-2">{badge.name}</h2>
            <p className="text-sm text-muted-foreground mb-7 leading-relaxed">{badge.description}</p>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 gap-2 rounded-xl" onClick={handleShare}>
                <Share2 className="w-4 h-4" />
                Share
              </Button>
              <Button className="flex-1 rounded-xl" onClick={onClose}>
                Awesome! 🎉
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}