"use client";

import { DailyCallFrame } from "./DailyCallFrame";

export function VoiceCall({ url, displayName, onLeave, onError }: { url: string; displayName: string; onLeave: () => void; onError?: (msg: string) => void }) {
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Voice-specific header — audio-focused, no large video tiles */}
      <div className="rounded-2xl border border-hairline bg-[#0a0a0a] px-5 py-3 text-white">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">Voice Call — Audio first</p>
        <p className="mt-1 text-sm text-white/80">Everyone joins muted-ready, camera off. Tap <span className="font-semibold text-white">Share Screen</span> to show your screen — it will appear as the main view for all.</p>
      </div>
      <div className="flex-1 min-h-[420px]">
        <DailyCallFrame url={url} type="voice" displayName={displayName} onLeave={onLeave} onError={onError} />
      </div>
      <p className="text-center font-mono text-[11px] text-steel">Voice is SFU + simulcast — weak wifi gets lower bitrate automatically, others stay crisp • NAT via Daily TURN</p>
    </div>
  );
}
