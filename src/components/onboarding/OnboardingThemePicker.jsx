import React, { useState } from "react";
import { Moon, Sun, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { COLOR_THEMES } from "@/lib/ThemeContext";
import { cn } from "@/lib/utils";

function ThemePreviewCard({ theme, isDark, selected, onClick }) {
  const bg = isDark ? theme.darkBg : theme.bg;
  const primary = theme.primary;
  const accent = theme.accent;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative rounded-2xl overflow-hidden border-2 transition-all duration-200 text-left w-full",
        selected
          ? "shadow-xl scale-[1.03]"
          : "border-transparent opacity-80 hover:opacity-100 hover:scale-[1.01]"
      )}
      style={{ backgroundColor: `hsl(${bg})`, ...(selected ? { borderColor: `hsl(${primary})` } : {}) }}
    >
      {/* Mini header bar */}
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ backgroundColor: `hsl(${primary})` }}
      >
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-white/40" />
          <div className="w-2 h-2 rounded-full bg-white/40" />
        </div>
        <div className="text-white text-[9px] font-bold opacity-90">Strk</div>
        <div className="w-4 h-4 rounded-full bg-white/20" />
      </div>

      {/* Mini habit card */}
      <div className="p-2.5 space-y-1.5">
        {[theme.label, "Exercise"].map((name, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5"
            style={{
              backgroundColor: isDark ? `hsl(${primary} / 0.12)` : `hsl(${primary} / 0.07)`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: `hsl(${i === 0 ? primary : accent})` }}
              aria-hidden="true"
            />
            <div className="flex-1">
              <div
                className="h-1.5 rounded-full w-14 mb-1"
                style={{ backgroundColor: `hsl(${i === 0 ? primary : accent})` }}
              />
              <div
                className="h-1 rounded-full w-8 opacity-40"
                style={{ backgroundColor: `hsl(${primary})` }}
              />
            </div>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: i === 0 ? `hsl(${primary})` : "transparent", border: i === 1 ? `1.5px solid hsl(${accent})` : "none" }}
            >
              {i === 0 && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Label */}
      <div className="px-3 pb-2.5 flex items-center gap-1.5">
        <p className="text-[11px] font-bold" style={{ color: `hsl(${primary})` }}>
          {theme.label}
        </p>
        {theme.isDefault && (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: `hsl(${primary} / 0.15)`, color: `hsl(${primary})` }}>
            Default
          </span>
        )}
      </div>

      {/* Selected checkmark */}
      {selected && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `hsl(${primary})` }}
        >
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </button>
  );
}

export default function OnboardingThemePicker({ onComplete }) {
  const [selectedTheme, setSelectedTheme] = useState("strk");
  const [isDark, setIsDark] = useState(false);

  const handleComplete = () => {
    if (!selectedTheme) return;
    onComplete({ themeId: selectedTheme, isDark });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-5 py-10 sm:py-16">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✨</span>
          </div>
          <div className="mb-2">
            <span className="text-2xl font-black text-foreground tracking-tight">Strk</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Make it yours</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Build streaks. Stay accountable. Pick a theme to get started.
          </p>
        </div>

        {/* Dark mode toggle */}
        <div className="flex items-center justify-between bg-muted rounded-2xl px-4 py-3 mb-6">
          <div className="flex items-center gap-3">
            {isDark
              ? <Moon className="w-4 h-4 text-blue-500" />
              : <Sun className="w-4 h-4 text-amber-500" />
            }
            <div>
              <p className="text-foreground text-sm font-semibold">Dark Mode</p>
              <p className="text-muted-foreground text-xs">{isDark ? "Previewing dark themes" : "Previewing light themes"}</p>
            </div>
          </div>
          <Switch
            checked={isDark}
            onCheckedChange={setIsDark}
          />
        </div>

        {/* Default theme — full width */}
        {(() => {
          const defaultTheme = COLOR_THEMES.find(t => t.id === "strk");
          const otherThemes = COLOR_THEMES.filter(t => t.id !== "strk");
          return (
            <>
              {defaultTheme && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Default</p>
                  <ThemePreviewCard
                    theme={defaultTheme}
                    isDark={isDark}
                    selected={selectedTheme === defaultTheme.id}
                    onClick={() => setSelectedTheme(defaultTheme.id)}
                  />
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 mb-8">
                {otherThemes.map((theme) => (
                  <ThemePreviewCard
                    key={theme.id}
                    theme={theme}
                    isDark={isDark}
                    selected={selectedTheme === theme.id}
                    onClick={() => setSelectedTheme(theme.id)}
                  />
                ))}
              </div>
            </>
          );
        })()}

        {/* CTA */}
        <Button
          size="lg"
          className="w-full rounded-2xl h-14 text-base font-bold gap-2 transition-all duration-300 shadow-xl disabled:opacity-50"
          disabled={!selectedTheme}
          onClick={handleComplete}
        >
          Start Tracking
          <ArrowRight className="w-5 h-5" />
        </Button>

        {!selectedTheme && (
          <p className="text-center text-muted-foreground text-xs mt-3">Select a theme to continue</p>
        )}
        {selectedTheme && (
          <p className="text-center text-muted-foreground text-xs mt-3">You can change this anytime in Settings</p>
        )}
      </div>
    </div>
  );
}
