"use client";

import { useEffect, useState } from "react";
import {
  canRequestChatPermission,
  getChatAppEnabled,
  getChatNotificationPermission,
  isChatNotificationSupported,
  isChatPrePromptDismissed,
  requestChatNotificationPermission,
  setChatAppEnabled,
  setChatPrePromptDismissed,
  shouldShowChatPrePrompt,
} from "@/lib/chatNotifications";

export function ChatNotificationPopup({ userId }: { userId?: string | null }) {
  const [permission, setPermission] = useState<ReturnType<typeof getChatNotificationPermission>>("default");
  const [dismissed, setDismissed] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isChatNotificationSupported()) return;
    setPermission(getChatNotificationPermission());
    setDismissed(isChatPrePromptDismissed(userId));
    const t = setTimeout(() => {
      const perm = getChatNotificationPermission();
      const dis = isChatPrePromptDismissed(userId);
      if (shouldShowChatPrePrompt(perm, dis)) setShow(true);
    }, 1200);
    const onVis = () => {
      setPermission(getChatNotificationPermission());
    };
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearTimeout(t);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [userId]);

  if (!show || !canRequestChatPermission()) return null;
  if (!shouldShowChatPrePrompt(permission, dismissed)) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]" onClick={() => { setShow(false); }}>
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Chat notifications">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink text-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h3 className="mt-4 text-center font-display text-lg font-bold text-ink">Stay in the loop?</h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-steel">Get a quick ping when someone messages you — even if chat is in the background. You can turn this off anytime in Settings.</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setChatPrePromptDismissed(true, userId);
              setDismissed(true);
              setShow(false);
            }}
            className="flex-1 rounded-full border border-hairline py-2.5 text-sm font-semibold text-ink hover:bg-fog"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await requestChatNotificationPermission();
                setPermission(result as any);
                if (result === "granted") {
                  setChatAppEnabled(true, userId);
                  setShow(false);
                } else if (result === "denied") {
                  setShow(false);
                } else {
                  setShow(false);
                }
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-full bg-ink py-2.5 text-sm font-semibold text-white hover:bg-charcoal disabled:opacity-50"
          >
            {busy ? "…" : "Allow"}
          </button>
        </div>
        <p className="mt-3 text-center font-mono text-[11px] text-stone">Browser will ask once — click Allow to enable.</p>
      </div>
    </div>
  );
}

export function ChatNotificationBlockedNotice({ userId }: { userId?: string | null }) {
  const [permission, setPermission] = useState<ReturnType<typeof getChatNotificationPermission>>("default");
  useEffect(() => {
    if (!isChatNotificationSupported()) return;
    setPermission(getChatNotificationPermission());
    const iv = setInterval(() => setPermission(getChatNotificationPermission()), 2000);
    return () => clearInterval(iv);
  }, []);
  if (permission !== "denied") return null;
  if (getChatAppEnabled(userId)) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Chat notifications are blocked</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">You blocked notifications for this site. To re-enable: click the lock icon in the address bar → Site settings → Notifications → Allow, then reload.</p>
    </div>
  );
}

export function ChatNotificationToggle({ userId }: { userId?: string | null }) {
  const [permission, setPermission] = useState<ReturnType<typeof getChatNotificationPermission>>("default");
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setPermission(getChatNotificationPermission());
    setEnabled(getChatAppEnabled(userId));
    const iv = setInterval(() => {
      setPermission(getChatNotificationPermission());
      setEnabled(getChatAppEnabled(userId));
    }, 1500);
    return () => clearInterval(iv);
  }, [userId]);

  const toggle = async () => {
    if (!isChatNotificationSupported()) return;
    if (permission === "denied") {
      alert("Notifications are blocked in browser settings. Enable them via the lock icon → Site settings.");
      return;
    }
    if (permission !== "granted") {
      const res = await requestChatNotificationPermission();
      setPermission(res as any);
      if (res !== "granted") return;
    }
    const next = !enabled;
    setChatAppEnabled(next, userId);
    setEnabled(next);
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-ink">Chat notifications</p>
        <p className="mt-0.5 text-xs leading-relaxed text-steel">
          {permission === "denied" ? "Blocked in browser — enable in site settings first." : enabled ? "On — you’ll get pings for new messages." : "Off — turn on to get pings."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => void toggle()}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? "bg-ink" : "bg-hairline"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}
