"use client";

import { useState } from "react";
import { ActiveCallIndicator } from "./ActiveCallIndicator";
import { ScheduleMeetingModal } from "./ScheduleMeetingModal";

export function StartContextCall({
  context,
  contextId,
  label = "Start Call",
}: {
  context: "project" | "checkpoint";
  contextId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const start = async (type: "voice" | "video") => {
    setCreating(type);
    setError(null);
    try {
      const res = await fetch("/api/calls/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, context, contextId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not start call");
      const url: string = data.dailyRoomUrl;
      // Open in Calls hub with context — for now, open Daily URL in new tab and also navigate to Calls
      // Better: navigate to /calls with join param
      const name: string = data.dailyRoomName;
      window.location.assign(`/calls?join=${encodeURIComponent(name)}`);
      try {
        await navigator.clipboard.writeText(url);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-canvas px-3 py-1.5 text-xs font-semibold hover:border-ink"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {label}
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-hairline bg-canvas p-2 shadow-xl">
            <button
              onClick={() => start("voice")}
              disabled={!!creating}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-fog disabled:opacity-50"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-white text-xs">♪</span>
              <span>
                <span className="block font-semibold">Voice</span>
                <span className="block text-xs text-steel">Audio-first</span>
              </span>
            </button>
            <button
              onClick={() => start("video")}
              disabled={!!creating}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-fog disabled:opacity-50"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0e7a64] text-white text-xs">◉</span>
              <span>
                <span className="block font-semibold">Video</span>
                <span className="block text-xs text-steel">Camera on</span>
              </span>
            </button>
            {error && <p className="px-2 py-1 text-xs text-red-600">{error}</p>}
            <button
              onClick={() => {
                setOpen(false);
                setShowSchedule(true);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-fog"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-violet text-white text-xs">◷</span>
              <span>
                <span className="block font-semibold">Schedule…</span>
                <span className="block text-xs text-steel">One-time or recurring</span>
              </span>
            </button>
            <p className="px-2 pt-1 font-mono text-[11px] text-steel">Screen share works in both</p>
          </div>
        )}
      </div>
      <ActiveCallIndicator
        context={context}
        contextId={contextId}
        onJoin={(call) => {
          window.location.assign(`/calls?join=${encodeURIComponent(call.dailyRoomName)}`);
        }}
      />
      {showSchedule && (
        <ScheduleMeetingModal
          open={showSchedule}
          onClose={() => setShowSchedule(false)}
          onCreated={() => window.location.assign("/calls")}
          defaultProjectId={context === "project" ? contextId : null}
        />
      )}
    </div>
  );
}
