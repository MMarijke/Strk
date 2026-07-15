import React, { useState } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/api/supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState(null);

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
      setError(signInError.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full px-5 py-16 justify-center">
        <div className="mb-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔥</span>
          </div>
          <div className="mb-2">
            <span className="text-2xl font-black text-white tracking-tight">Strk</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Sign in</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Build streaks. Stay accountable. — We'll email you a link, no password needed.
          </p>
        </div>

        {status === "sent" ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <p className="text-white font-medium">Check your inbox</p>
            <p className="text-slate-400 text-sm">
              We sent a sign-in link to <span className="text-white">{email}</span>.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="text-sm text-slate-400 underline underline-offset-2"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                type="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 pl-10 text-base bg-white/10 border-white/20 text-white placeholder:text-slate-500 rounded-xl focus:border-white/40"
              />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <Button
              type="submit"
              size="lg"
              disabled={status === "sending" || !email.trim()}
              className={cn(
                "w-full rounded-2xl h-14 text-base font-bold transition-all duration-300",
                "bg-white text-slate-900 hover:bg-white/90 shadow-xl disabled:opacity-50"
              )}
            >
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
