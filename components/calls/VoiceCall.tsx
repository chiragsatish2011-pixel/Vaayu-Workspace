"use client";

import { DailyCallFrame } from "./DailyCallFrame";

export function VoiceCall({ url, displayName, onLeave, onError }: { url: string; displayName: string; onLeave: () => void; onError?: (msg: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-[420px]">
        <DailyCallFrame url={url} type="voice" displayName={displayName} onLeave={onLeave} onError={onError} />
      </div>
    </div>
  );
}
