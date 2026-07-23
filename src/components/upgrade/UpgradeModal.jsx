import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { openCheckout, PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID } from "@/lib/paddle";

const BENEFITS = [
  { emoji: "🔥", label: "Unlimited groups" },
  { emoji: "❄️", label: "Unlimited streak freezes" },
  { emoji: "📊", label: "Full 12-week analytics" },
];

export default function UpgradeModal({ onClose }) {
  const { user } = useAuth();

  const handleMonthly = () => openCheckout(PADDLE_MONTHLY_PRICE_ID, user?.email);
  const handleAnnual = () => openCheckout(PADDLE_ANNUAL_PRICE_ID, user?.email);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-card border border-border shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6 pt-1">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight mb-1.5">
            Unlock Strk Pro 🔥
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything you need to build lasting habits
          </p>
        </div>

        <div className="space-y-2.5 mb-6">
          {BENEFITS.map((b) => (
            <div
              key={b.label}
              className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3"
            >
              <span className="text-lg leading-none">{b.emoji}</span>
              <span className="text-sm font-medium text-foreground">{b.label}</span>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <Button
            onClick={handleMonthly}
            variant="outline"
            size="lg"
            className="w-full h-12 rounded-2xl font-semibold"
          >
            $4.99 / month
          </Button>

          <div className="relative">
            <span className="absolute -top-2.5 right-4 z-10 text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full shadow-sm">
              Save 25%
            </span>
            <Button
              onClick={handleAnnual}
              size="lg"
              className="w-full h-14 rounded-2xl font-bold text-base"
            >
              $44.99 / year
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
