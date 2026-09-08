"use client";

import { useEffect, useState } from "react";

type ActiveCall = {
  id: string;
  type: "voice" | "video";
  context: "standalone" | "project" | "checkpoint";
  contextId: string | null;
  dailyRoomName: string;
  dailyRoomUrl: string;
};

export function ActiveCallIndicator({
  context,
  contextId,
  onJoin,
}: {
  context: "project" | "checkpoint";
  contextId: string;
  onJoin: (call: ActiveCall) => void;
}) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/calls/rooms", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.calls) {
          if (!cancelled) setLoading(false);
          return;
        }
        const found = (data.calls as ActiveCall[]).find((c) => c.context === context && c.contextId === contextId);
        if (!cancelled) {
          setCall(found || null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void check();
    const iv = setInterval(check, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [context, contextId]);

  if (loading || !call) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 animate-pulse">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      <span className="text-xs font-semibold text-emerald-900">Call in progress — {call.type}</span>
      <button onClick={() => onJoin(call)} className="ml-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
        Join
      </button>
    </div>
  );
}

export function StandaloneActiveCalls({ onJoin }: { onJoin: (call: ActiveCall) => void }) {
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/calls/rooms", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.calls) {
          if (!cancelled) setCalls(data.calls as ActiveCall[]);
        }
      } catch {}
    }
    void load();
    const iv = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);
  if (calls.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Active calls</p>
      {calls.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-fog/50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold capitalize">
              {c.type} call · <span className="font-mono text-xs text-steel">{c.context}{c.contextId ? `:${c.contextId.slice(0, 6)}` : ""}</span>
            </p>
            <p className="font-mono text-xs text-steel">{new Date(c.dailyRoomName.slice(-8)).toString().slice(0, 24)} • {c.dailyRoomName}</p>
          </div>
          <button onClick={() => onJoin(c)} className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">
            Join
          </button>
        </div>
      ))}
    </div>
  );
}
