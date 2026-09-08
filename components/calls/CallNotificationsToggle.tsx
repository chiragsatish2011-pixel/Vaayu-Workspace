"use client";

import { useEffect, useState } from "react";
import {
  getAppEnabled,
  getNotificationPermission,
  isNotificationSupported,
  setAppEnabled,
  type CallNotificationPermission,
  requestNotificationPermission,
  canRequestPermission,
} from "@/lib/callNotifications";

export function CallNotificationsToggle({ userId }: { userId?: string | null }) {
  const [permission, setPermission] = useState<CallNotificationPermission>("default");
  const [appEnabled, setAppEnabledState] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPermission(getNotificationPermission());
    setAppEnabledState(getAppEnabled(userId));
    const onStorage = () => {
      setPermission(getNotificationPermission());
      setAppEnabledState(getAppEnabled(userId));
    };
    window.addEventListener("storage", onStorage);
    // Also poll permission in case user changes it in browser settings and returns
    const iv = window.setInterval(() => setPermission(getNotificationPermission()), 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(iv);
    };
  }, [userId]);

  const toggle = async () => {
    // If permission not yet granted, the toggle should drive the pre-prompt flow (user gesture)
    if (permission === "default") {
      if (!canRequestPermission()) return;
      setBusy(true);
      try {
        const result = await requestNotificationPermission();
        setPermission(result);
        if (result === "granted") {
          setAppEnabled(true, userId);
          setAppEnabledState(true);
          try {
            new Notification("Notifications enabled", { body: "You’ll get alerts for incoming calls while your browser is open." });
          } catch {}
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (permission === "granted") {
      const next = !appEnabled;
      setAppEnabled(next, userId);
      setAppEnabledState(next);
    }
    // if denied, toggle does nothing — we show instructions instead
  };

  const supported = isNotificationSupported();
  const isOn = permission === "granted" ? appEnabled : false;

  if (!supported) {
    return (
      <div className="flex items-center justify-between gap-4 opacity-60">
        <div>
          <p className="text-sm font-semibold text-ink">Call notifications</p>
          <p className="mt-0.5 text-xs text-steel">This browser doesn’t support notifications.</p>
        </div>
        <span className="text-xs text-stone">Unsupported</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">Call notifications</p>
        <p className="mt-0.5 text-xs leading-relaxed text-steel">
          {permission === "granted" ? (
            isOn ? (
              "On — you’ll get an in-app banner and a browser notification when someone starts a call."
            ) : (
              "Off — the browser permission is still allowed, but the app won’t send you call alerts."
            )
          ) : permission === "denied" ? (
            "Blocked in your browser — allow notifications in site settings to turn this on."
          ) : (
            "Get an in-app alert and a browser notification when someone calls — even if the tab is backgrounded."
          )}
        </p>
        <p className="mt-1 font-mono text-[11px] text-stone">
          Works only while your browser is open (even if backgrounded/minimized). Ringing while closed needs a native app — coming later.
        </p>
        {permission === "denied" && (
          <p className="mt-1 text-xs text-amber-800">To re-enable: address-bar lock icon → Site settings → Notifications → Allow. We can’t re-prompt after you block — that’s a browser privacy rule.</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label="Call notifications"
        disabled={busy || permission === "denied"}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
          isOn ? "bg-ink" : "bg-hairline"
        } ${permission === "denied" || busy ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span
          aria-hidden
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${isOn ? "left-6" : "left-1"}`}
        />
      </button>
    </div>
  );
}
