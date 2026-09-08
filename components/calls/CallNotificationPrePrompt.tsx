"use client";

import { useEffect, useState } from "react";
import {
  canRequestPermission,
  getNotificationPermission,
  isPrePromptDismissed,
  isNotificationSupported,
  requestNotificationPermission,
  setAppEnabled,
  setPrePromptDismissed,
  type CallNotificationPermission,
} from "@/lib/callNotifications";

export function CallNotificationPrePrompt({ userId }: { userId?: string | null }) {
  const [permission, setPermission] = useState<CallNotificationPermission>("default");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justGranted, setJustGranted] = useState(false);

  useEffect(() => {
    setPermission(getNotificationPermission());
    setDismissed(isPrePromptDismissed(userId));
  }, [userId]);

  if (!isNotificationSupported()) return null;
  if (permission !== "default") return null;
  if (dismissed) return null;

  const onEnable = async () => {
    if (!canRequestPermission()) return;
    setBusy(true);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result === "granted") {
        setAppEnabled(true, userId);
        setJustGranted(true);
        setPrePromptDismissed(true, userId);
        // Optional: fire a gentle confirmation notification so the user sees it works.
        // Only if they just granted — guarded by permission check.
        try {
          if (result === "granted") {
            new Notification("Notifications enabled", {
              body: "You’ll get an alert when someone starts a call. Works while your browser is open.",
            });
          }
        } catch {}
      } else if (result === "denied") {
        setPrePromptDismissed(true, userId);
      }
    } finally {
      setBusy(false);
    }
  };

  const onNotNow = () => {
    setPrePromptDismissed(true, userId);
    setDismissed(true);
  };

  if (justGranted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-emerald-900">
          <span className="font-semibold">Notifications on.</span> You’ll get an alert when someone calls — works while your browser is open (even if this tab is backgrounded).
        </p>
        <span className="text-emerald-700 text-xs">✓ Enabled</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-fog/50 p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Get notified when someone calls you</p>
          <p className="mt-1 text-xs leading-relaxed text-steel">
            Enable call notifications to get an in-app alert and a browser notification when a teammate starts a call — even if this tab is in the background.
            <span className="block mt-1 font-mono text-[11px] text-stone">You’ll see one browser prompt to allow it. Works only while your browser is open — background “ringing” while closed needs a native app (coming later).</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onEnable}
            disabled={busy}
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white hover:bg-charcoal disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable"}
          </button>
          <button onClick={onNotNow} className="rounded-full border border-hairline px-4 py-2 text-sm font-medium text-steel hover:border-ink hover:text-ink">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function CallNotificationBlockedNotice() {
  const [perm, setPerm] = useState<CallNotificationPermission>("default");
  useEffect(() => setPerm(getNotificationPermission()), []);
  if (perm !== "denied") return null;
  return (
    <div className="rounded-2xl border border-hairline bg-amber-50/70 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Call notifications are off</p>
      <p className="mt-1 text-xs leading-relaxed text-steel">
        You’ve blocked notifications for this site. To turn them back on, open your browser’s site settings (usually the lock icon in the address bar → Site settings → Notifications → Allow).
        Your app-level toggle in Settings will work again once the browser permission is allowed. We can’t re-prompt automatically — browsers block that for privacy.
      </p>
    </div>
  );
}
