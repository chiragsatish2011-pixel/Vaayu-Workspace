"use client";

import { useTheme } from "@/components/ThemeProvider";
import { useEffect, useState } from "react";

export function ThemeToggle({
  variant = "icon",
  className = "",
}: {
  variant?: "icon" | "pill" | "select";
  className?: string;
}) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`h-9 w-9 rounded-full border border-hairline bg-fog opacity-50 ${className}`} />
    );
  }

  const isDark = resolvedTheme === "dark";

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`press inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-canvas px-3.5 text-xs font-semibold text-ink shadow-xs transition hover:border-steel ${className}`}
      >
        {isDark ? (
          <>
            <SunIcon className="h-4 w-4 text-amber-400" />
            <span>Light mode</span>
          </>
        ) : (
          <>
            <MoonIcon className="h-4 w-4 text-violet-500" />
            <span>Dark mode</span>
          </>
        )}
      </button>
    );
  }

  if (variant === "select") {
    return (
      <div className={`flex items-center gap-1.5 rounded-xl border border-hairline bg-fog p-1 ${className}`}>
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            theme === "light"
              ? "bg-canvas text-ink shadow-xs border border-hairline-soft"
              : "text-steel hover:text-ink"
          }`}
        >
          <SunIcon className="h-4 w-4 text-amber-500" />
          <span>Light</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            theme === "dark"
              ? "bg-canvas text-ink shadow-xs border border-hairline-soft"
              : "text-steel hover:text-ink"
          }`}
        >
          <MoonIcon className="h-4 w-4 text-violet-400" />
          <span>Dark</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            theme === "system"
              ? "bg-canvas text-ink shadow-xs border border-hairline-soft"
              : "text-steel hover:text-ink"
          }`}
        >
          <MonitorIcon className="h-4 w-4 text-azure" />
          <span>System</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`press grid h-9 w-9 place-items-center rounded-full border border-hairline bg-canvas text-ink transition hover:border-steel ${className}`}
    >
      {isDark ? (
        <SunIcon className="h-4 w-4 text-amber-400" />
      ) : (
        <MoonIcon className="h-4 w-4 text-violet-600" />
      )}
    </button>
  );
}

function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function MonitorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}
