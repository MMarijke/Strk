import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Mail, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";
import { setPendingPlan } from "@/lib/pendingPlan";

// Manual useState + zod .safeParse() on submit, matching this codebase's
// established form convention (InvitePartnerModal.jsx, CreateChallengeModal.jsx)
// rather than react-hook-form + zodResolver -- both are installed but unused
// anywhere in the app, so this is the lower-diff, more-consistent choice.
//
// Password: 8 chars minimum, no mandatory mixed-case/digit/symbol rule.
// NIST SP 800-63B explicitly recommends against composition requirements --
// they measurably increase abandonment without meaningfully stopping
// credential-stuffing or brute force, both of which Supabase's own
// rate-limiting mitigates better than a complexity rule ever could. This
// client-side minimum is UX guidance; Supabase's own backend minimum
// (dashboard-configurable) is the real enforcement layer either way.
const signupSchema = z
  .object({
    email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

// Signup's own error vocabulary differs from Login's -- separate from
// Login.jsx's translateAuthError rather than shared, since "this email may
// already be registered" is a signup-only case with no login equivalent.
function translateSignupError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already exists")) {
    return "An account may already exist for that email. Try logging in instead, or use a different email.";
  }
  if (m.includes("password") && (m.includes("short") || m.includes("at least") || m.includes("weak"))) {
    return "Password must be at least 8 characters.";
  }
  if (m.includes("rate limit")) {
    return "Too many attempts. Please wait a minute before trying again.";
  }
  if (m.includes("unable to validate") || (m.includes("invalid") && m.includes("email"))) {
    return "That doesn't look like a valid email address.";
  }
  return "Something went wrong creating your account. Please try again.";
}

export default function Signup() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // idle | submitting | needsConfirmation | error
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Same mechanism as Login.jsx's own effect -- Signup is now the primary
  // landing point for ?plan=pro traffic from Landing's pricing section, so
  // this needs to work here too, not just on Login.
  useEffect(() => {
    const plan = searchParams.get("plan");
    if (plan === "pro") setPendingPlan(plan);
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const result = signupSchema.safeParse({ email, password, confirmPassword });
    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) {
        errors[issue.path[0]] = issue.message;
      }
      setFieldErrors(errors);
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setStatus("submitting");

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: result.data.email,
      password: result.data.password,
      options: { emailRedirectTo: window.location.origin },
    });

    if (signUpError) {
      setError(translateSignupError(signUpError.message));
      setStatus("error");
      return;
    }

    if (data?.session) {
      // Instant access -- AuthContext's own getSession()/onAuthStateChange
      // picks up the new session automatically, nothing else to do here.
      return;
    }

    // data.session is null: the dashboard's "Confirm email" setting is still
    // on despite the product decision to skip it. Handled gracefully, not
    // as an error -- this is a normal, expected branch if that toggle
    // hasn't been flipped yet.
    setStatus("needsConfirmation");
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
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Create your account</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Build streaks. Stay accountable.
          </p>
        </div>

        {status === "needsConfirmation" ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-muted-foreground text-sm">
              We sent a confirmation link to <span className="text-foreground">{email}</span>.
              Click it to finish creating your account.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
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
              {fieldErrors.email && <p className="text-xs text-destructive-text mt-1">{fieldErrors.email}</p>}
            </div>

            <div className="relative">
              <Label htmlFor="password" className="sr-only">Password</Label>
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="Password (min. 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 pl-10 pr-10 text-base rounded-xl"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              {fieldErrors.password && <p className="text-xs text-destructive-text mt-1">{fieldErrors.password}</p>}
            </div>

            <div className="relative">
              <Label htmlFor="confirmPassword" className="sr-only">Confirm password</Label>
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-12 pl-10 text-base rounded-xl"
              />
              {fieldErrors.confirmPassword && <p className="text-xs text-destructive-text mt-1">{fieldErrors.confirmPassword}</p>}
            </div>

            {error && <p className="text-xs text-destructive-text">{error}</p>}

            <Button
              type="submit"
              size="lg"
              disabled={status === "submitting" || !email.trim() || !password || !confirmPassword}
              className={cn(
                "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
                "shadow-xl disabled:opacity-50"
              )}
            >
              {status === "submitting" ? "Creating account…" : "Create account"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-foreground underline underline-offset-2">
                Log in
              </Link>
            </p>

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
