"use client";

import { useEffect, useRef, useState } from "react";
import { formatVoiceDuration } from "@/components/mentions/audioNote";

/**
 * Inline audio player for voice notes stored on Drive.
 * Streams via /api/drive/download?inline=1 (same-origin, session cookie flows).
 */
export function VoicePlayer({
  driveId,
  label,
  durationSec,
}: {
  driveId: string;
  label?: string | null;
  durationSec?: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState<number>(typeof durationSec === "number" ? durationSec : 0);
  const [failed, setFailed] = useState(false);

  const src = `/api/drive/download?id=${encodeURIComponent(driveId)}&inline=1`;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setT(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDur(el.duration);
    };
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, [src]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      setFailed(false);
      el.play().then(
        () => setPlaying(true),
        () => setFailed(true)
      );
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    try {
      el.currentTime = ratio * dur;
      setT(ratio * dur);
    } catch {
      // Range seeks can fail on proxied streams — playback still works.
    }
  };

  const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;

  return (
    <span className="my-1 flex w-full min-w-[220px] max-w-[320px] items-center gap-2.5 rounded-xl border border-hairline bg-white px-3 py-2 text-ink">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white transition hover:bg-charcoal"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold leading-tight">{label || "Voice note"}</span>
        <span onClick={seek} className="mt-1.5 block h-1.5 cursor-pointer rounded-full bg-fog" role="presentation">
          <span className="block h-full rounded-full bg-ink transition-[width]" style={{ width: `${pct}%` }} />
        </span>
        <span className="mt-1 block font-mono text-[10px] leading-none text-steel">
          {formatVoiceDuration(t)} / {formatVoiceDuration(dur)}
        </span>
      </span>
      <a
        href={src}
        download
        onClick={(e) => e.stopPropagation()}
        aria-label="Download voice note"
        title="Download"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-steel transition hover:bg-fog hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      </a>
      {failed && <span className="shrink-0 text-[10px] font-medium text-error">Play failed</span>}
    </span>
  );
}
