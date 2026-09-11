"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "vaayu:theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (stored && (stored === "light" || stored === "dark" || stored === "system")) {
        setThemeState(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      let active: "light" | "dark";
      if (theme === "system") {
        active = mediaQuery.matches ? "dark" : "light";
      } else {
        active = theme;
      }

      setResolvedTheme(active);

      if (active === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    applyTheme();

    const handleSystemChange = () => {
      if (theme === "system") {
        applyTheme();
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const active = prev === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : prev;
      const next = active === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: "system" as ThemeMode,
      resolvedTheme: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? ("dark" as const) : ("light" as const),
      setTheme: (mode: ThemeMode) => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        const isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        if (isDark) root.classList.add("dark");
        else root.classList.remove("dark");
        try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
      },
      toggleTheme: () => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        const nextDark = !root.classList.contains("dark");
        if (nextDark) root.classList.add("dark");
        else root.classList.remove("dark");
        try { localStorage.setItem(STORAGE_KEY, nextDark ? "dark" : "light"); } catch {}
      },
    };
  }
  return context;
}
