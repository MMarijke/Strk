import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { saveMyDisplayName } from "@/lib/displayName";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/api/supabaseClient";

export default function OnboardingDisplayName({ onComplete }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const isValid = trimmed.length >= 2 && trimmed.length <= 20;

  const handleContinue = () => {
    if (!isValid) return;
    // Fire the save in the background — don't block onboarding on it
    saveMyDisplayName(user?.email, trimmed)
      .catch((err) => console.error("Onboarding save failed:", err));
    trackEvent("signup_completed");
    supabase.functions
      .invoke("send-welcome-email", { body: { display_name: trimmed } })
      .catch((err) => console.error("Welcome email failed:", err));
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full px-5 py-16 justify-center">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">👋</span>
          </div>
          <div className="mb-2">
            <span className="text-2xl font-black text-white tracking-tight">Strk</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">What should we call you?</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Build streaks. Stay accountable. — This name shows up on leaderboards and group views.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-4">
          <Input
            autoFocus
            placeholder="e.g. Marijke, M 🔥, or anything you like"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleContinue()}
            className="h-12 text-base bg-white/10 border-white/20 text-white placeholder:text-slate-500 rounded-xl focus:border-white/40"
          />

          {name.length > 0 && !isValid && (
            <p className="text-xs text-red-400">
              {trimmed.length < 2 ? "At least 2 characters required" : "Maximum 20 characters"}
            </p>
          )}

          <Button
            size="lg"
            disabled={saving || !isValid}
            onClick={handleContinue}
            className={cn(
              "w-full rounded-2xl h-14 text-base font-bold gap-2 transition-all duration-300",
              "bg-white text-slate-900 hover:bg-white/90 shadow-xl disabled:opacity-50"
            )}
          >
            Let's go
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}