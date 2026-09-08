"use client";

import { useEffect, useRef, useState } from "react";
import { triggerIncomingCallNotification } from "@/lib/callNotifications";

type ActiveCall = {
  id: string;
  type: "voice" | "video";
  context: "standalone" | "project" | "checkpoint";
  contextId: string | null;
  dailyRoomName: string;
  dailyRoomUrl: string;
  createdAt?: string;
};

export function IncomingCallBanner({
  activeUrl,
  onJoin,
  userId,
}: {
  activeUrl?: string | null;
  onJoin: (call: ActiveCall) => void;
  userId?: string | null;
}) {
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/calls/rooms", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.calls) return;
        const list = data.calls as ActiveCall[];
        if (cancelled) return;
        setCalls(list);
        // Detect new calls to trigger notification
        for (const c of list) {
          if (seenIds.current.has(c.id)) continue;
          seenIds.current.add(c.id);
          // Don't notify for the call we're already in
          if (activeUrl && c.dailyRoomUrl === activeUrl) continue;
          if (dismissedId === c.id) continue;
          // Only notify if we're not already in an active call (avoid spam while in call)
          if (activeUrl) continue;
          // Check if call is recent (created within last 60s) to avoid notifying for stale rooms on first load
          if (c.createdAt) {
            const age = Date.now() - new Date(c.createdAt).getTime();
            if (age > 90_000) continue; // older than 90s — don't treat as incoming
          }
          // Always show in-app banner regardless; browser notification helper checks permission + appEnabled
          // Works while browser open, even if backgrounded (honest constraint)
          const body = `${c.type === "voice" ? "Voice" : "Video"} call · ${c.context}${c.contextId ? `:${c.contextId.slice(0, 6)}` : ""}`;
          // Trigger browser notification (honest: only while browser open, even if backgrounded)
          // This will no-op if permission denied/default or app disabled.
          triggerIncomingCallNotification({
            title: "Incoming call",
            body,
            joinUrl: `/calls?join=${encodeURIComponent(c.dailyRoomName)}`,
            userId,
          });
          // In-app banner is driven by rendering below — no extra state needed beyond calls list
        }
        // Prune seenIds that are no longer active
        const activeIds = new Set(list.map((c) => c.id));
        for (const id of Array.from(seenIds.current)) {
          if (!activeIds.has(id)) seenIds.current.delete(id);
        }
      } catch {}
    }
    poll();
    const iv = window.setInterval(poll, 8000);
    const onVis = () => {
      // Re-poll when tab becomes visible — catches calls started while hidden
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeUrl, dismissedId, userId]);

  // Don't show banner if already in a call or no calls
  if (activeUrl) return null;
  // Pick the most recent call that we haven't dismissed
  const incoming = calls.find((c) => c.id !== dismissedId);
  if (!incoming) return null;

  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white shrink-0">
          <span aria-hidden>{incoming.type === "voice" ? "♪" : "◉"}</span>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900 truncate">
            Incoming {incoming.type} call
            <span className="ml-2 font-mono text-xs font-normal text-emerald-700 hidden sm:inline">
              {incoming.context}
              {incoming.contextId ? `:${incoming.contextId.slice(0, 6)}` : ""}
            </span>
          </p>
          <p className="text-xs text-emerald-800/80 truncate">
            {document.visibilityState !== "visible" ? "Browser notification sent — " : ""}
            {incoming.type === "voice" ? "Audio-first" : "Video"} · tap Join to enter
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onJoin(incoming)} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          Join
        </button>
        <button
          onClick={() => setDismissedId(incoming.id)}
          aria-label="Dismiss"
          className="grid h-8 w-8 place-items-center rounded-full text-emerald-700 hover:bg-emerald-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
