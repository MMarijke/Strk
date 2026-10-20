import React, { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";

const emailSchema = z.string().trim().min(1, "Enter your email.").email("Enter a valid email address.");

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setError(null);
    setStatus("sending");

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(result.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    // Always show the same success state regardless of whether this email
    // is actually registered -- Supabase itself doesn't leak that, and
    // special-casing "no such account" here would leak it ourselves. Only
    // a genuine failure (network, rate limit) surfaces as an error.
    if (resetError && !resetError.message?.toLowerCase().includes("rate limit")) {
      setStatus("sent");
      return;
    }
    if (resetError) {
      setError("Too many attempts. Please wait a minute before trying again.");
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
            <Link to="/" className="text-2xl font-black text-foreground tracking-tight hover:opacity-80 transition-opacity">
              Strk
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Reset your password</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We'll email you a link to set a new one.
          </p>
        </div>

        {status === "sent" ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-muted-foreground text-sm">
              If an account exists for <span className="text-foreground">{email}</span>, we sent a password reset link.
            </p>
            <Link to="/login" className="text-sm text-muted-foreground underline underline-offset-2">
              Back to login
            </Link>
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
            </div>

            {error && <p className="text-xs text-destructive-text">{error}</p>}

            <Button
              type="submit"
              size="lg"
              disabled={status === "sending" || !email.trim()}
              className={cn(
                "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
                "shadow-xl disabled:opacity-50"
              )}
            >
              {status === "sending" ? "Sending…" : "Send reset link"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link to="/login" className="font-semibold text-foreground underline underline-offset-2">
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
