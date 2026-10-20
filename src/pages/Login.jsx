import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";
import { setPendingPlan } from "@/lib/pendingPlan";

// Supabase's own message for a wrong password and for a nonexistent email
// is the same string ("Invalid login credentials") -- deliberately not
// trying to distinguish them further here either. Confirming "no account
// with that email" would be a user-enumeration leak the backend itself
// doesn't make.
//
// Accounts created before this app had passwords (the old magic-link/OTP
// flow) have no password set at all, so they hit this exact same message --
// with no way to tell them apart from a plain wrong-password attempt, the
// hint below is appended unconditionally rather than only for migrated
// accounts. That's deliberate: it costs nothing for a correctly-typed
// password, and it's the one sentence that unblocks someone whose account
// predates passwords without adding a second, enumeration-risky lookup.
function translateAuthError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials") || (m.includes("invalid") && m.includes("credentials"))) {
    return 'Invalid email or password. If your account is from before we added passwords, use "Forgot password?" above to set one.';
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email before logging in. Check your inbox for a confirmation link.";
  }
  if (m.includes("rate limit")) {
    return "Too many attempts. Please wait a minute before trying again.";
  }
  return "Something went wrong logging in. Please try again.";
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | submitting | error
  const [error, setError] = useState(null);
  const errorRef = useRef(null);

  // A failed login previously had no programmatic announcement -- the
  // error <p> rendered with nothing to tell assistive tech it just
  // appeared. role="alert" below announces it; focusing it here backs
  // that up for AT/browser combinations that miss a freshly-mounted
  // live region, and gives keyboard users a visible anchor too.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Remembers a plan chosen on Landing's pricing section (?plan=pro) across
  // the signup round-trip, which a query param alone can't survive -- see
  // pendingPlan.js. Dashboard checks this once auth completes and redirects
  // to Subscription for "pro". Signup.jsx is the primary landing point for
  // this param now, but Login still honors it for anyone who lands here
  // directly with it attached (e.g. a bookmarked /login?plan=pro link).
  useEffect(() => {
    const plan = searchParams.get("plan");
    if (plan === "pro") setPendingPlan(plan);
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) return;

    setStatus("submitting");
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (signInError) {
      setError(translateAuthError(signInError.message));
      setStatus("error");
      return;
    }
    // Success: AuthContext's own getSession()/onAuthStateChange picks up
    // the new session automatically, nothing else to do here.
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full px-5 py-16 justify-center">
        <div className="mb-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔥</span>
          </div>
          <div className="mb-2">
            <Link to="/" className="text-2xl font-black text-foreground tracking-tight hover:opacity-80 transition-opacity">
              Strk
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Log in</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">Build streaks. Stay accountable.</p>
          <p className="text-muted-foreground text-sm leading-relaxed">Your streak — and your friends — are waiting.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            {/* sr-only rather than a visible label -- the icon+placeholder
                pairing is the deliberate visual design here, but screen
                readers still need a real accessible name. */}
            <Label htmlFor="email" className="sr-only">Email address</Label>
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoFocus
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 pl-10 text-base rounded-xl"
            />
          </div>

          <div className="relative">
            <Label htmlFor="password" className="sr-only">Password</Label>
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 pl-10 pr-10 text-base rounded-xl"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-right -mt-1">
            <Link to="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Forgot password?
            </Link>
          </div>

          {error && (
            <p
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="text-xs text-destructive-text outline-none focus:ring-2 focus:ring-destructive-text focus:ring-offset-2 focus:ring-offset-background rounded-sm"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={status === "submitting" || !email.trim() || !password}
            className={cn(
              "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
              "shadow-xl disabled:opacity-50"
            )}
          >
            {status === "submitting" ? "Logging in…" : "Log in"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="font-semibold text-foreground underline underline-offset-2">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
