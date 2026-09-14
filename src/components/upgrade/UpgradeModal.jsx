import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/lib/AuthContext";
import { openCheckout, PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID } from "@/lib/paddle";
import { usePaddlePrices } from "@/hooks/usePaddlePrices";
import { formatPrice } from "@/lib/utils";

const BENEFITS = [
  { emoji: "🔥", label: "Unlimited groups" },
  { emoji: "❄️", label: "Unlimited streak freezes" },
  { emoji: "📊", label: "Full 12-week analytics" },
];

// Price display is purely cosmetic -- openCheckout() below always opens
// with the real priceId regardless of whether this label resolved, so a
// slow/failed fetch degrades the copy, never the ability to check out.
function PriceLabel({ price, isLoading, suffix, fallback }) {
  if (isLoading) {
    return <span className="inline-block h-4 w-14 rounded bg-current/20 animate-pulse align-middle" />;
  }
  const label = formatPrice(price);
  return label ? <>{label} {suffix}</> : fallback;
}

export default function UpgradeModal({ onClose }) {
  const { user } = useAuth();
  const { monthly, annual, isLoading } = usePaddlePrices();

  const handleCheckoutError = (err) => {
    toast.error(err?.message || "Could not start checkout. Please try again.", { duration: 4000 });
  };
  const handleMonthly = () => openCheckout(PADDLE_MONTHLY_PRICE_ID, user?.email).catch(handleCheckoutError);
  const handleAnnual = () => openCheckout(PADDLE_ANNUAL_PRICE_ID, user?.email).catch(handleCheckoutError);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm rounded-3xl p-6 gap-0">
        <div className="text-center mb-6 pt-1">
          <DialogTitle className="text-2xl font-extrabold text-foreground tracking-tight mb-1.5">
            Unlock Strk Pro 🔥
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Everything you need to build lasting habits
          </DialogDescription>
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
            <PriceLabel price={monthly} isLoading={isLoading} suffix="/ month" fallback="Monthly" />
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
              <PriceLabel price={annual} isLoading={isLoading} suffix="/ year" fallback="Annual — save 25%" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
