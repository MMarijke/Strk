import React, { useState, useEffect } from "react";
import { ArrowLeft, CreditCard, Sparkles, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  getSubscriptionDetails, switchSubscriptionPlan, cancelSubscription, resumeSubscription,
} from "@/lib/manageSubscription";
import { PADDLE_MONTHLY_PRICE_ID, PADDLE_ANNUAL_PRICE_ID } from "@/lib/paddle";

const PRO_BENEFITS = [
  { emoji: "🔥", label: "Unlimited groups" },
  { emoji: "❄️", label: "Unlimited streak freezes" },
  { emoji: "📊", label: "Full 12-week analytics" },
];

const STATUS_STYLES = {
  active: "bg-primary/20 text-primary",
  trialing: "bg-primary/20 text-primary",
  past_due: "bg-amber-500/20 text-amber-600",
  paused: "bg-muted text-muted-foreground",
  canceled: "bg-destructive/20 text-destructive",
};

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPrice(price) {
  if (!price?.unit_price) return null;
  const amount = Number(price.unit_price.amount) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: price.unit_price.currency_code }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export default function Subscription() {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [paymentMethodsError, setPaymentMethodsError] = useState(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    getSubscriptionDetails()
      .then(({ subscription, paymentMethods, paymentMethodsError }) => {
        setSubscription(subscription);
        setPaymentMethod(paymentMethods?.[0] || null);
        setPaymentMethodsError(paymentMethodsError || null);
        setNotFound(false);
      })
      .catch((err) => {
        if (err.message === "No subscription on file") setNotFound(true);
        else setLoadError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const runAction = async (fn) => {
    setActionPending(true);
    setActionError(null);
    try {
      const { subscription: updated } = await fn();
      setSubscription(updated);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionPending(false);
    }
  };

  const currentPriceId = subscription?.items?.[0]?.price?.id;
  const isAnnual = currentPriceId === PADDLE_ANNUAL_PRICE_ID;
  const targetPlan = isAnnual
    ? { priceId: PADDLE_MONTHLY_PRICE_ID, label: "Switch to Monthly" }
    : { priceId: PADDLE_ANNUAL_PRICE_ID, label: "Switch to Annual — save 25%" };

  const pendingCancellation = subscription?.scheduled_change?.action === "cancel";
  const status = subscription?.status;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/Settings">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Manage Subscription</h1>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : notFound ? (
          <Card className="border-0 shadow-sm p-5">
            <p className="text-sm font-semibold text-foreground mb-1">No subscription found</p>
            <p className="text-xs text-muted-foreground mb-4">
              We couldn't find a Paddle subscription on file for your account.
            </p>
            <a
              href="mailto:seedstackstudio@gmail.com?subject=Manage%20my%20subscription"
              className="text-xs font-medium text-primary hover:underline"
            >
              Contact support to manage
            </a>
          </Card>
        ) : loadError ? (
          <Card className="border-0 shadow-sm p-5 border border-destructive/20">
            <p className="text-sm font-semibold text-destructive mb-1">Couldn't load your subscription</p>
            <p className="text-xs text-muted-foreground mb-4">{loadError}</p>
            <Button size="sm" variant="outline" onClick={load}>Try again</Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {actionError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {actionError}
              </div>
            )}

            {/* Plan card */}
            <Card className="border-0 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-1">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">
                  Strk Pro — {isAnnual ? "Annual" : "Monthly"}
                </h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                {formatPrice(subscription?.items?.[0]?.price) || "—"} / {isAnnual ? "year" : "month"}
              </p>
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize",
                  STATUS_STYLES[status] || "bg-muted text-muted-foreground"
                )}>
                  {status?.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {pendingCancellation
                    ? `Cancels ${formatDate(subscription.scheduled_change.effective_at)}`
                    : subscription?.next_billed_at
                      ? `Renews ${formatDate(subscription.next_billed_at)}`
                      : null}
                </span>
              </div>
            </Card>

            {/* Payment method card */}
            <Card className="border-0 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-3">
                <CreditCard className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">Payment Method</h2>
              </div>
              {paymentMethod?.card ? (
                <p className="text-sm text-foreground mb-3 capitalize">
                  {paymentMethod.card.type} •••• {paymentMethod.card.last4}
                  <span className="text-muted-foreground">
                    {" "}— expires {String(paymentMethod.card.expiry_month).padStart(2, "0")}/{paymentMethod.card.expiry_year}
                  </span>
                </p>
              ) : paymentMethod?.paypal ? (
                <p className="text-sm text-foreground mb-3">PayPal — {paymentMethod.paypal.email}</p>
              ) : (
                <p className="text-sm text-muted-foreground mb-3">
                  {paymentMethodsError ? `Couldn't load payment method: ${paymentMethodsError}` : "No payment method on file"}
                </p>
              )}
              {subscription?.management_urls?.update_payment_method && (
                <a
                  href={subscription.management_urls.update_payment_method}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Update payment method
                </a>
              )}
            </Card>

            {/* Switch plan */}
            {!pendingCancellation && (
              <Card className="border-0 shadow-sm p-5">
                <h2 className="font-semibold text-sm mb-1">Change Plan</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Switching takes effect immediately, prorated against your current billing period.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" disabled={actionPending}>
                      {targetPlan.label}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{targetPlan.label}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your plan will change immediately and you'll be charged (or credited) a prorated
                        amount for the rest of this billing period.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => runAction(() => switchSubscriptionPlan(targetPlan.priceId))}
                        disabled={actionPending}
                      >
                        {actionPending ? "Switching…" : "Confirm switch"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Card>
            )}

            {/* Resume — only when a cancellation is pending */}
            {pendingCancellation && (
              <Card className="border-0 shadow-sm p-5 border border-primary/20 bg-primary/5">
                <h2 className="font-semibold text-sm mb-1">Subscription ending</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Your Pro access continues until {formatDate(subscription.scheduled_change.effective_at)},
                  then your plan will move to Free. Changed your mind?
                </p>
                <Button
                  size="sm"
                  onClick={() => runAction(resumeSubscription)}
                  disabled={actionPending}
                  className="gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {actionPending ? "Resuming…" : "Resume Subscription"}
                </Button>
              </Card>
            )}

            {/* Danger zone */}
            {!pendingCancellation && (
              <Card className="border-0 shadow-sm p-5 border border-destructive/20">
                <div className="flex items-center gap-3 mb-1">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h2 className="font-semibold text-sm text-destructive">Cancel Subscription</h2>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  You'll keep Pro access until the end of your current billing period.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={actionPending}>
                      Cancel Subscription
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You'll lose access to:
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 -mt-2">
                      {PRO_BENEFITS.map((b) => (
                        <div key={b.label} className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-2.5">
                          <span className="text-base leading-none">{b.emoji}</span>
                          <span className="text-sm font-medium text-foreground">{b.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You'll keep Pro until {formatDate(subscription?.next_billed_at) || "the end of this billing period"}.
                    </p>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep my subscription</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => runAction(cancelSubscription)}
                        disabled={actionPending}
                      >
                        {actionPending ? "Cancelling…" : "Yes, cancel"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
