"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "vaayu:theme";

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function getStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {}
  return "system";
}

export const DEFAULT_ACCENT = "#0a0a0a";
const ACCENT_STORAGE_KEY = "vaayu:workspace:accent";

/**
 * Apply the workspace accent (Settings → Personalize). The accent tints
 * PRIMARY BUTTONS ONLY via `--workspace-accent` (see globals.css).
 *
 * It must NEVER write `--color-ink`: that variable is the body/text color,
 * and older builds hijacked it here — with the default black accent that
 * painted every heading black in dark mode (invisible on the dark canvas).
 * This also migrates those browsers by removing any stale inline value so
 * the stylesheet's per-mode text color applies again.
 */
export function applyWorkspaceAccent(color: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--workspace-accent", color);
  if (color === DEFAULT_ACCENT) root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", "custom");
  root.style.removeProperty("--color-ink");
}

export function getStoredAccent(): string {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  try {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Shared hook — header toggle + Settings appearance selector stay in sync. */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => getStoredTheme());
  const [resolved, setResolvedState] = useState<ResolvedTheme>(() =>
    typeof window === "undefined" ? "light" : resolveTheme(getStoredTheme())
  );
  const [mounted, setMounted] = useState(false);

  // Push the current choice to the DOM (external-system sync, no setState).
  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  // One-time subscriptions: mount flag + OS theme + cross-tab storage.
  // setState only runs inside callbacks, never synchronously in the body.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredTheme() === "system") {
        setResolvedState(resolveTheme("system"));
      }
    };
    mq.addEventListener?.("change", onChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const next =
          e.newValue === "light" || e.newValue === "dark" || e.newValue === "system"
            ? e.newValue
            : "system";
        setChoiceState(next);
        setResolvedState(resolveTheme(next));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener?.("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setResolvedState(resolveTheme(next));
    applyTheme(next);
  }, []);

  return { choice, resolved, set, mounted };
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    </svg>
  );
}

/** Header theme toggle — sun in dark mode, moon in light mode. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { resolved, set, mounted } = useTheme();

  const next: ThemeChoice = resolved === "dark" ? "light" : "dark";
  const label = resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={() => set(next)}
      title={label}
      aria-label={label}
      aria-pressed={mounted && resolved === "dark"}
      className={`press grid place-items-center rounded-full border border-hairline bg-canvas text-ink transition-colors hover:bg-fog ${
        compact ? "h-9 w-9" : "h-10 w-10"
      }`}
    >
      {!mounted ? (
        <MoonIcon className="h-5 w-5" />
      ) : resolved === "dark" ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </button>
  );
}
