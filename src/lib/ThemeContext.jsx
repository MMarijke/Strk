import React, { createContext, useContext, useEffect, useRef, useState } from "react";

export const COLOR_THEMES = [
  // primary at 36% lightness, not 55% -- 55% paired with white button text
  // (--primary-foreground) measured at 2.34:1 contrast, under half the
  // WCAG AA floor. 36% clears it at ~4.67:1 with the same hue/saturation.
  // This is the value that actually reaches the page: the effect below
  // applies it via root.style.setProperty on every mount (including the
  // logged-out Landing page, which has no stored theme choice yet and
  // falls back to this entry), overriding src/index.css's own --primary.
  { id: "strk",    label: "Strk",     primary: "34 80% 36%",  accent: "42 90% 68%",  bg: "60 20% 98%",  darkBg: "60 8% 11%",  isDefault: true },
  { id: "green",   label: "Forest",   primary: "100 19% 55%", accent: "28 48% 53%",  bg: "80 17% 96%",  darkBg: "60 8% 11%" },
  { id: "blue",    label: "Ocean",    primary: "207 26% 55%", accent: "189 30% 61%", bg: "207 20% 96%", darkBg: "60 8% 11%" },
  { id: "purple",  label: "Lavender", primary: "271 19% 62%", accent: "303 21% 69%", bg: "271 20% 97%", darkBg: "60 8% 11%" },
  { id: "rose",    label: "Rose",     primary: "347 34% 62%", accent: "22 52% 63%",  bg: "347 20% 97%", darkBg: "60 8% 11%" },
  { id: "amber",   label: "Sunset",   primary: "25 55% 62%",  accent: "17 44% 58%",  bg: "25 20% 97%",  darkBg: "60 8% 11%" },
  { id: "teal",    label: "Mint",     primary: "171 24% 59%", accent: "140 27% 66%", bg: "171 20% 96%", darkBg: "60 8% 11%" },
];

const ThemeContext = createContext(null);

// Keys scoped to a user id so two different users on the same device
// don't share onboarding / theme state.
function storageKey(userId, name) {
  return userId ? `habit-${name}-${userId}` : `habit-${name}`;
}

// Reads every piece of theme/onboarding state for a given userId (or the
// unscoped fallback keys if userId is undefined, i.e. before auth resolves).
// Shared by the initial useState reads and the resync effect below so the
// two can't drift out of sync with each other.
function readStateForUser(userId) {
  const themeId = localStorage.getItem(storageKey(userId, "theme")) || "strk";

  const storedDark = localStorage.getItem(storageKey(userId, "dark"));
  const isDark = storedDark !== null
    ? storedDark === "true"
    : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  const onboarded = localStorage.getItem(storageKey(userId, "onboarded")) === "true";
  const onboardStep = onboarded ? "done" : (localStorage.getItem(storageKey(userId, "onboard-step")) || "theme");

  return { themeId, isDark, onboarded, onboardStep };
}

export function ThemeProvider({ children, userId }) {
  const [themeId, setThemeId] = useState(() => readStateForUser(userId).themeId);
  const [isDark, setIsDark] = useState(() => readStateForUser(userId).isDark);
  const [onboarded, setOnboarded] = useState(() => readStateForUser(userId).onboarded);
  const [onboardStep, setOnboardStep] = useState(() => readStateForUser(userId).onboardStep);

  // Auth resolves asynchronously, so this provider always mounts first with
  // userId=undefined — the useState calls above read the unscoped fallback
  // keys at that point. Once the real userId arrives a moment later, re-read
  // everything from the correctly-scoped keys instead of leaving this state
  // permanently locked to the wrong ones (lazy useState initializers only
  // ever run once, on mount — they won't naturally pick this up).
  const prevUserIdRef = useRef(userId);
  useEffect(() => {
    if (prevUserIdRef.current === userId) return;
    prevUserIdRef.current = userId;

    const next = readStateForUser(userId);
    setThemeId(next.themeId);
    setIsDark(next.isDark);
    setOnboarded(next.onboarded);
    setOnboardStep(next.onboardStep);
  }, [userId]);

  useEffect(() => {
    const theme = COLOR_THEMES.find((t) => t.id === themeId) || COLOR_THEMES[0];
    const root = document.documentElement;

    root.style.setProperty("--primary", theme.primary);
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--ring", theme.primary);
    root.style.setProperty("--chart-1", theme.primary);
    root.style.setProperty("--chart-2", theme.accent);

    if (isDark) {
      root.classList.add("dark");
      root.style.setProperty("--background", theme.darkBg);
    } else {
      root.classList.remove("dark");
      root.style.setProperty("--background", theme.bg);
    }

    // Keeps the mobile browser's status bar in sync with the actual
    // in-app theme/dark-mode choice, not just the initial static value in
    // index.html -- previously this never updated after first paint, so
    // every color theme and dark mode itself all showed the same
    // hardcoded ember-orange status bar regardless of what was actually
    // selected. Light mode keeps the branded primary-accent strip (the
    // already-shipped look); dark mode uses the dark background instead
    // of the light-mode accent color, so the status bar blends with a
    // dark UI rather than showing a bright, unrelated color above it.
    // theme.primary/darkBg are already "H S% L%" triplets in the same
    // space-separated syntax CSS hsl() accepts directly, no conversion
    // needed.
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", `hsl(${isDark ? theme.darkBg : theme.primary})`);
    }

    localStorage.setItem(storageKey(userId, "theme"), themeId);
    localStorage.setItem(storageKey(userId, "dark"), isDark);
  }, [themeId, isDark, userId]);

  const completeTheme = ({ themeId: newThemeId, isDark: newDark }) => {
    setThemeId(newThemeId);
    setIsDark(newDark);
    setOnboardStep("name");
    localStorage.setItem(storageKey(userId, "onboard-step"), "name");
    localStorage.setItem(storageKey(userId, "theme"), newThemeId);
    localStorage.setItem(storageKey(userId, "dark"), newDark);
  };

  const completeOnboarding = ({ themeId: newThemeId, isDark: newDark }) => {
    setThemeId(newThemeId);
    setIsDark(newDark);
    setOnboarded(true);
    setOnboardStep("done");
    localStorage.setItem(storageKey(userId, "onboarded"), "true");
    localStorage.setItem(storageKey(userId, "theme"), newThemeId);
    localStorage.setItem(storageKey(userId, "dark"), newDark);
  };

  const completeDisplayName = () => {
    setOnboarded(true);
    setOnboardStep("done");
    localStorage.setItem(storageKey(userId, "onboarded"), "true");
    localStorage.setItem(storageKey(userId, "onboard-step"), "done");
  };

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId, isDark, setIsDark, onboarded, onboardStep, completeTheme, completeOnboarding, completeDisplayName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
