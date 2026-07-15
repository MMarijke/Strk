import React, { createContext, useContext, useEffect, useState } from "react";

export const COLOR_THEMES = [
  { id: "strk",    label: "Strk",     primary: "34 80% 55%",  accent: "42 90% 68%",  bg: "60 20% 98%",  darkBg: "60 8% 11%",  isDefault: true },
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

export function ThemeProvider({ children, userId }) {
  const [themeId, setThemeId] = useState(() => localStorage.getItem(storageKey(userId, "theme")) || "strk");
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem(storageKey(userId, "dark"));
    if (stored !== null) return stored === "true";
    // Default to system preference
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(storageKey(userId, "onboarded")) === "true");
  const [onboardStep, setOnboardStep] = useState(() => {
    if (localStorage.getItem(storageKey(userId, "onboarded")) === "true") return "done";
    return localStorage.getItem(storageKey(userId, "onboard-step")) || "theme";
  });

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