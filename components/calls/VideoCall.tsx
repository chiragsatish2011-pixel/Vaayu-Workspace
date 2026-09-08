"use client";

import { DailyCallFrame } from "./DailyCallFrame";

export function VideoCall({ url, displayName, onLeave, onError }: { url: string; displayName: string; onLeave: () => void; onError?: (msg: string) => void }) {
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Video-specific header — grid, active speaker */}
      <div className="rounded-2xl border border-hairline bg-gradient-to-br from-[#0e7a64] to-[#22ab94] px-5 py-3 text-white">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/80">Video Call — Camera on</p>
        <p className="mt-1 text-sm text-white/90">Grid of video tiles with <span className="font-semibold">active-speaker</span> highlight. Mute, camera, screen share, and leave are in the top bar.</p>
      </div>
      <div className="flex-1 min-h-[480px]">
        <DailyCallFrame url={url} type="video" displayName={displayName} onLeave={onLeave} onError={onError} />
      </div>
      <p className="text-center font-mono text-[11px] text-steel">Video is SFU + simulcast + adaptive — throttling one participant never freezes others • Reconnecting shows amber banner</p>
    </div>
  );
}
