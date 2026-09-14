import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";
import { setPendingPlan } from "@/lib/pendingPlan";

// signInWithOtp is magic-link/OTP, not password auth -- there's no
// "wrong password" case here. Matched by keyword rather than exact
// string equality since Supabase's precise wording isn't something we
// can verify without triggering it live; a brittle exact match would
// silently stop translating anything if it differs slightly.
function translateAuthError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("rate limit")) {
    return "You've requested a link recently. Please wait a minute before trying again.";
  }
  if (m.includes("unable to validate") || (m.includes("invalid") && m.includes("email"))) {
    return "That doesn't look like a valid email address.";
  }
  if (m.includes("signup") && m.includes("not allowed")) {
    return "New sign-ups aren't open right now. If you already have an account, please try again shortly.";
  }
  return "Something went wrong sending your sign-in link. Please try again.";
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState(null);

  // Remembers a plan chosen on Landing's pricing section (?plan=pro) across
  // the magic-link round-trip, which a query param alone can't survive --
  // see pendingPlan.js. Dashboard checks this once auth completes and
  // redirects to Subscription for "pro", so the choice isn't silently
  // dropped the way it used to be.
  useEffect(() => {
    const plan = searchParams.get("plan");
    if (plan === "pro") setPendingPlan(plan);
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus("sending");
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });

    if (signInError) {
      setError(translateAuthError(signInError.message));
      setStatus("error");
      return;
    }
    setStatus("sent");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full px-5 py-16 justify-center">
        <div className="mb-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔥</span>
          </div>
          <div className="mb-2">
            <span className="text-2xl font-black text-foreground tracking-tight">Strk</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Sign in</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Build streaks. Stay accountable. We'll email you a link, no password needed.
          </p>
        </div>

        {status === "sent" ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-muted-foreground text-sm">
              We sent a sign-in link to <span className="text-foreground">{email}</span>.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 pl-10 text-base rounded-xl"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              type="submit"
              size="lg"
              disabled={status === "sending" || !email.trim()}
              className={cn(
                "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
                "shadow-xl disabled:opacity-50"
              )}
            >
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>

            <p className="text-center text-xs text-muted-foreground leading-relaxed">
              By continuing, you agree to our{" "}
              <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
