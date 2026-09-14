import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

export default function BadgeCelebrationModal({ badge, onClose }) {
  useEffect(() => {
    if (!badge) return;
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#a78bfa", "#f59e0b", "#34d399", "#f472b6"] });
  }, [badge]);

  const handleShare = () => {
    const text = `I just earned the "${badge.name}" badge on Strk! ${badge.emoji} 🏆`;
    navigator.clipboard.writeText(text);
  };

  return (
    <Dialog open={!!badge} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm rounded-3xl p-8 text-center gap-0">
        {badge && (
          <>
            {/* The one authored motion moment kept from the previous
                bespoke implementation -- unrelated to the modal shell
                itself (now Dialog's own animate-in/out), just the badge
                icon's wiggle-in. */}
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
            <DialogTitle className="text-2xl font-extrabold text-foreground mb-2">{badge.name}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mb-7 leading-relaxed">
              {badge.description}
            </DialogDescription>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 gap-2 rounded-xl" onClick={handleShare}>
                <Share2 className="w-4 h-4" />
                Share
              </Button>
              <Button className="flex-1 rounded-xl" onClick={onClose}>
                Awesome! 🎉
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
