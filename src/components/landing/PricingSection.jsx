import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePaddlePrices } from "@/hooks/usePaddlePrices";
import { formatPrice, cn } from "@/lib/utils";

const FREE_INCLUDES = [
  "Daily & weekly habit tracking",
  "Groups & group challenges",
  "Focus sessions with friends",
  "2 streak freezes / month",
];

const PRO_INCLUDES = [
  "Everything in Free",
  "Unlimited groups",
  "Unlimited streak freezes",
  "Full 12-week trends",
];

function PriceLine({ price, isLoading, isError }) {
  if (isLoading) {
    return <span className="inline-block h-8 w-20 rounded-lg bg-muted animate-pulse" />;
  }
  const label = formatPrice(price);
  if (!label) {
    // get_prices (the edge function backing this) is a public, anonymous
    // endpoint -- pricing was never actually gated behind sign-in, so the
    // old copy here ("Sign in to see pricing") misattributed a Paddle
    // fetch timeout/error as an intentional auth wall at exactly the
    // moment a visitor is deciding whether to trust the product.
    return (
      <span className="text-sm text-muted-foreground">
        {isError ? "Couldn't load pricing — please refresh" : "Pricing unavailable right now"}
      </span>
    );
  }
  return (
    <span className="text-3xl font-black text-foreground tracking-tight">
      {label}
      <span className="text-sm font-medium text-muted-foreground"> /mo</span>
    </span>
  );
}

// Computed from the live fetched prices rather than a hardcoded "25%" --
// this is exactly the "remembered number" PRODUCT.md says the pricing
// surface must never display, so if Paddle's catalog prices ever drift
// apart this recalculates instead of silently going stale.
function annualSavingsPct(monthly, annual) {
  const monthlyCents = Number(monthly?.unit_price?.amount);
  const annualCents = Number(annual?.unit_price?.amount);
  if (!monthlyCents || !annualCents) return null;
  return Math.round((1 - annualCents / (monthlyCents * 12)) * 100);
}

export default function PricingSection() {
  const { monthly, annual, isLoading, isError } = usePaddlePrices();
  const annualLabel = formatPrice(annual);
  const savingsPct = annualSavingsPct(monthly, annual);

  return (
    <section id="pricing" className="px-6 py-14 max-w-2xl mx-auto scroll-mt-6">
      <h2 className="text-xl font-extrabold text-foreground tracking-tight text-center mb-2">
        Simple pricing
      </h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm mx-auto mb-10">
        Free is a genuinely complete habit tracker. Pro removes the limits.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Free */}
        <div className="rounded-3xl bg-card border border-border p-6 flex flex-col">
          <h3 className="font-bold text-sm text-foreground mb-1">Free</h3>
          <div className="mb-5">
            <span className="text-3xl font-black text-foreground tracking-tight">$0</span>
          </div>
          <ul className="space-y-2.5 mb-6 flex-1">
            {FREE_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <Link to="/login?plan=free">
            {/* Parallel to Pro's "Sign in to go Pro" below -- both buttons
                and the hero's "Sign in" now share one verb family so three
                buttons routing to the same passwordless /login don't read
                as three different flows. The ?plan param lets Login.jsx
                remember which one was chosen -- see pendingPlan.js. */}
            <Button variant="outline" className="w-full rounded-2xl h-11 font-semibold">
              Sign in to start free
            </Button>
          </Link>
        </div>

        {/* Pro */}
        <div
          className={cn(
            "relative rounded-3xl border p-6 flex flex-col",
            "bg-gradient-to-b from-primary/10 to-card border-primary/30 shadow-lg"
          )}
        >
          <span className="absolute -top-2.5 right-6 text-[10px] font-bold bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full shadow-sm">
            Most popular
          </span>
          <h3 className="font-bold text-sm text-foreground mb-1">Pro</h3>
          <div className="mb-5">
            <PriceLine price={monthly} isLoading={isLoading} isError={isError} />
            {!isLoading && annualLabel && (
              <p className="text-xs text-muted-foreground mt-1.5">
                or {annualLabel}/year{savingsPct ? ` — save ${savingsPct}%` : ""}
              </p>
            )}
          </div>
          <ul className="space-y-2.5 mb-6 flex-1">
            {PRO_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <Link to="/login?plan=pro">
            <Button className="w-full rounded-2xl h-11 font-bold">Sign in to go Pro</Button>
          </Link>
        </div>
      </div>

      {/* Reassurance right after the decision itself -- the pricing card is
          the highest-stakes moment on the page, and previously offered
          nothing here beyond a technical footnote about where prices come
          from. Both claims are real: Free has never required payment
          details, and Subscription.jsx's cancel flow is a genuine
          self-service cancellation (effective at the next billing period),
          not a "contact support" runaround. */}
      <p className="text-center text-xs text-muted-foreground mt-6">
        No card required for Free · Cancel Pro anytime
      </p>
      <p className="text-center text-xs text-muted-foreground mt-1">
        Prices shown are live from Paddle.
      </p>
    </section>
  );
}
