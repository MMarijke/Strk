import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

/**
 * Reached via the link in a password-reset email. Supabase's redirect
 * fires a PASSWORD_RECOVERY auth event and establishes a real, valid
 * session for the account being recovered -- which is exactly why this
 * page is mounted as a top-level public route in App.jsx (alongside
 * /terms and /privacy), not inside AuthenticatedApp's !isAuthenticated
 * branch: a recovery session makes isAuthenticated true, and a user who
 * just clicked the email link needs to land HERE, not get swept into the
 * main app before they've set a new password.
 */
export default function ResetPassword() {
  // checking | ready | invalid
  const [sessionState, setSessionState] = useState("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | submitting | done | error
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let active = true;

    // The PASSWORD_RECOVERY event can fire before this listener attaches
    // (the redirect's tokens are parsed very early by auth-js), so don't
    // rely on catching it live -- treat "a session exists at all on this
    // route" as sufficient. Ordinary users don't navigate to
    // /reset-password otherwise, recovery or not.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setSessionState("ready");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setSessionState((prev) => (prev === "ready" ? prev : session ? "ready" : "invalid"));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const result = passwordSchema.safeParse({ password, confirmPassword });
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

    const { error: updateError } = await supabase.auth.updateUser({ password: result.data.password });

    if (updateError) {
      setError("Couldn't update your password. Please try again.");
      setStatus("error");
      return;
    }

    setStatus("done");
    // Hard navigation, not router.navigate -- the simplest, least-ambiguous
    // handoff into the now-permanent session via AuthenticatedApp's normal
    // isAuthenticated path, rather than relying on this page's own local
    // state to coordinate with AuthContext's.
    setTimeout(() => {
      window.location.href = "/";
    }, 1200);
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
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Set a new password</h1>
        </div>

        {sessionState === "checking" && (
          <div className="flex justify-center py-8" role="status">
            <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" aria-hidden="true" />
            <span className="sr-only">Checking your reset link…</span>
          </div>
        )}

        {sessionState === "invalid" && (
          <div className="space-y-4 text-center">
            <p className="text-foreground font-medium">This link is invalid or has expired</p>
            <p className="text-muted-foreground text-sm">
              Password reset links only work once and expire after a while.
            </p>
            <Link to="/forgot-password" className="text-sm text-muted-foreground underline underline-offset-2">
              Request a new link
            </Link>
          </div>
        )}

        {sessionState === "ready" && status === "done" && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <p className="text-foreground font-medium">Password updated</p>
            <p className="text-muted-foreground text-sm">Taking you back into Strk…</p>
          </div>
        )}

        {sessionState === "ready" && status !== "done" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Label htmlFor="password" className="sr-only">New password</Label>
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoFocus
                required
                autoComplete="new-password"
                placeholder="New password (min. 8 characters)"
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
              <Label htmlFor="confirmPassword" className="sr-only">Confirm new password</Label>
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="Confirm new password"
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
              disabled={status === "submitting" || !password || !confirmPassword}
              className={cn(
                "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
                "shadow-xl disabled:opacity-50"
              )}
            >
              {status === "submitting" ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
