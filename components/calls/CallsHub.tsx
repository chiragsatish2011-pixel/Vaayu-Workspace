"use client";

import { useEffect, useState } from "react";
import { VoiceCall } from "./VoiceCall";
import { VideoCall } from "./VideoCall";
import { StandaloneActiveCalls } from "./ActiveCallIndicator";
import { CallNotificationPrePrompt, CallNotificationBlockedNotice } from "./CallNotificationPrePrompt";
import { IncomingCallBanner } from "./IncomingCallBanner";

export function CallsHub({ displayName, userId }: { displayName: string; userId?: string | null }) {
  const [active, setActive] = useState<{ url: string; type: "voice" | "video"; name: string } | null>(null);
  const [creating, setCreating] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createCall = async (type: "voice" | "video", context: "standalone" | "project" | "checkpoint" = "standalone", contextId?: string) => {
    setCreating(type);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/calls/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, context, contextId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not create room");
      const url: string = data.dailyRoomUrl;
      const name: string = data.dailyRoomName;
      setActive({ url, type, name });
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/calls?join=${encodeURIComponent(name)}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create call");
    } finally {
      setCreating(null);
    }
  };

  const leave = () => {
    setActive(null);
    setCopied(false);
    // Clean URL param if present
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("join")) {
        u.searchParams.delete("join");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {}
  };

  // Handle ?join= param — fetch calls list and auto-join the matching room
  useEffect(() => {
    if (active || creating) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const joinName = params.get("join");
      if (!joinName) return;
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch("/api/calls/rooms", { cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.calls) return;
          const found = (data.calls as { dailyRoomName: string; dailyRoomUrl: string; type: "voice" | "video" }[]).find((c) => c.dailyRoomName === joinName);
          if (found && !cancelled) {
            setActive({ url: found.dailyRoomUrl, type: found.type, name: found.dailyRoomName });
          }
        } catch {}
      })();
      return () => {
        cancelled = true;
      };
    } catch {}
  }, [active, creating]);

  if (active) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={leave} className="rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold hover:border-ink">
            ← Back to Calls hub
          </button>
          {copied && <span className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-white">Invite link copied</span>}
        </div>
        <div className="h-[560px] sm:h-[640px]">
          {active.type === "voice" ? (
            <VoiceCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          ) : (
            <VideoCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          )}
        </div>
        {error && (
          <div className="rounded-xl border border-hairline bg-canvas px-4 py-3 text-sm text-steel">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <CallNotificationPrePrompt userId={userId} />
      <CallNotificationBlockedNotice />
      <IncomingCallBanner activeUrl={null} onJoin={(call) => setActive({ url: call.dailyRoomUrl, type: call.type, name: call.dailyRoomName })} userId={userId} />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Voice card — polished, no debug jargon */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-[#0a0a0a] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/[0.07] blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/60">Audio first</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Voice Call</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/70">Start with camera off and add video anytime. Screen sharing is built in.</p>
          <button
            onClick={() => createCall("voice")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "voice" ? "Creating…" : "Start Voice Call →"}
          </button>
        </div>

        {/* Video card — polished, no technical footnotes */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-[#0e7a64] via-[#14b8a6] to-[#14b8a6] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/80">Camera on</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Video Call</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/90">Grid view with active-speaker highlight. Mute, camera, and screen sharing in one bar.</p>
          <button
            onClick={() => createCall("video")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-900 hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "video" ? "Creating…" : "Start Video Call →"}
          </button>
        </div>
      </div>

      <StandaloneActiveCalls onJoin={(call) => setActive({ url: call.dailyRoomUrl, type: call.type, name: call.dailyRoomName })} />

      <div className="rounded-2xl border border-hairline bg-fog/50 p-5">
        <p className="text-sm font-semibold text-ink">How invites work</p>
        <p className="mt-1 text-sm leading-relaxed text-steel">
          Starting a call creates a room you can share. Teammates viewing Calls see <span className="font-semibold">“Call in progress — Join”</span> and can hop in instantly. An invite link is also copied for you to paste anywhere.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-canvas p-5">
        <p className="text-sm font-semibold">Screen sharing</p>
        <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-steel space-y-1">
          <li>Choose a screen, window, or browser tab when prompted — others see it live.</li>
          <li>Works in both Voice and Video calls.</li>
        </ul>
      </div>
    </div>
  );
}
