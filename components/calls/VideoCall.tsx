"use client";

import { DailyCallFrame } from "./DailyCallFrame";

export function VideoCall({ url, displayName, onLeave, onError }: { url: string; displayName: string; onLeave: () => void; onError?: (msg: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-[480px]">
        <DailyCallFrame url={url} type="video" displayName={displayName} onLeave={onLeave} onError={onError} />
      </div>
    </div>
  );
}
