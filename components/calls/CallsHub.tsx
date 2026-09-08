"use client";

import { useState } from "react";
import { VoiceCall } from "./VoiceCall";
import { VideoCall } from "./VideoCall";
import { StandaloneActiveCalls } from "./ActiveCallIndicator";

export function CallsHub({ displayName }: { displayName: string }) {
  const [active, setActive] = useState<{ url: string; type: "voice" | "video"; name: string } | null>(null);
  const [creating, setCreating] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const createCall = async (type: "voice" | "video", context: "standalone" | "project" | "checkpoint" = "standalone", contextId?: string) => {
    setCreating(type);
    setError(null);
    setInviteUrl(null);
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
      setInviteUrl(url);
      setActive({ url, type, name });
      // Copy in-app link to clipboard as invite (not external Daily link alone — we show in-app indicator)
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/calls?join=${encodeURIComponent(name)}`);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create call");
    } finally {
      setCreating(null);
    }
  };

  const leave = () => {
    setActive(null);
    setInviteUrl(null);
  };

  // Handle ?join= param for invite link
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const joinName = params.get("join");
    if (joinName && !active && !creating) {
      // Auto-join via name — fetch the call to get URL
      // For now, just show inviteUrl handling is manual; join via button will create new room
      // To join existing, user clicks the "Join" on active calls list
    }
  }

  if (active) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={leave} className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold hover:border-ink">
            ← Back to Calls hub
          </button>
          {inviteUrl && (
            <span className="font-mono text-xs text-steel">
              Invite copied: <span className="text-ink">{inviteUrl.slice(0, 32)}…</span>
            </span>
          )}
        </div>
        <div className="h-[560px]">
          {active.type === "voice" ? (
            <VoiceCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          ) : (
            <VideoCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Voice card */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-[#0a0a0a] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/60">Audio first · Screen share ready</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Voice Call</h3>
          <p className="mt-2 text-sm text-white/80">Audio-only by default, no large tiles. Participant avatars with speaking rings, mute, and screen share. Screen becomes main view when shared.</p>
          <button
            onClick={() => createCall("voice")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "voice" ? "Creating…" : "Start Voice Call →"}
          </button>
          <p className="mt-3 font-mono text-[11px] text-white/50">SFU + simulcast · low-latency screen share</p>
        </div>

        {/* Video card */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-[#0e7a64] via-[#14b8a6] to-[#3daeff] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/80">Camera on · Grid + active speaker</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Video Call</h3>
          <p className="mt-2 text-sm text-white/90">Video tiles in grid, active-speaker highlight, camera toggle, mute, and screen share.</p>
          <button
            onClick={() => createCall("video")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-900 hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "video" ? "Creating…" : "Start Video Call →"}
          </button>
          <p className="mt-3 font-mono text-[11px] text-white/70">Adaptive bitrate · auto-reconnect · TURN/STUN via Daily</p>
        </div>
      </div>

      <StandaloneActiveCalls onJoin={(call) => setActive({ url: call.dailyRoomUrl, type: call.type, name: call.dailyRoomName })} />

      <div className="rounded-2xl border border-hairline bg-fog/50 p-5">
        <p className="text-sm font-semibold text-ink">How invites work</p>
        <p className="mt-1 text-sm text-steel">Starting a call creates an in-app room linked to <span className="font-mono text-xs">standalone</span> (or project/checkpoint when started contextually). Teammates viewing the same project or the Calls hub see <span className="font-semibold">“Call in progress — Join”</span> and can hop in without an external link. The shareable Daily URL is also copied to your clipboard for quick in-app paste.</p>
        <p className="mt-2 font-mono text-xs text-steel">Daily API key never leaves the server — browser only sees the room URL.</p>
      </div>

      <div className="rounded-2xl border border-hairline bg-canvas p-5">
        <p className="text-sm font-semibold">Screen share tips</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-steel space-y-1">
          <li>Pick any screen/window/tab in the browser picker — others see it near real-time.</li>
          <li>For fast content (code typing, scrolling), Daily uses 30fps encoding — prioritize frame rate over sharpness for smoothness.</li>
          <li>Works in both Voice and Video — screen share is not video-dependent.</li>
        </ul>
      </div>
    </div>
  );
}
