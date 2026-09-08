"use client";

import { useEffect, useRef, useState } from "react";
import { formatVoiceDuration } from "@/components/mentions/audioNote";

export interface UploadedVoiceNote {
  driveId: string;
  name: string;
  durationSec: number;
  mimeType: string;
}

const MAX_SECONDS = 10 * 60; // 10 min cap — well under the 5 MB direct-upload limit for opus

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {}
  }
  return "";
}

/**
 * Mic button + recording UI. Records with MediaRecorder, uploads the blob to
 * Drive (kind "voice" → Voice Notes folder), reports back the Drive file id.
 * The parent inserts it into the composer as an audio node.
 */
export function VoiceRecorder({
  onUploaded,
  onError,
}: {
  onUploaded: (note: UploadedVoiceNote) => void;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [supported] = useState(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("");

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  useEffect(() => cleanup, []);

  const fail = (message: string) => {
    cleanup();
    setState("idle");
    setElapsed(0);
    onError?.(message);
  };

  const start = async () => {
    if (state !== "idle" || !supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      mimeRef.current = rec.mimeType || mimeType || "audio/webm";
      streamRef.current = stream;
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => fail("Recording failed in this browser. Try Chrome or Edge.");
      rec.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_SECONDS) void stop(false);
      }, 500);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        fail("Microphone blocked — allow mic access in the browser, then try again.");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        fail("No microphone found on this device.");
      } else {
        fail("Could not start recording.");
      }
    }
  };

  const uploadBlob = async (blob: Blob, durationSec: number) => {
    setState("uploading");
    try {
      const ext = (mimeRef.current.split(";")[0] ?? "audio/webm").split("/")[1] || "webm";
      const name = `voice-note-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const file = new File([blob], name, { type: blob.type || "audio/webm" });
      const form = new FormData();
      form.append("kind", "voice");
      form.append("file", file);
      form.append("relativePath", "Voice Notes");
      const res = await fetch("/api/drive/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Voice note upload failed.");
      setState("idle");
      setElapsed(0);
      onUploaded({ driveId: data.id as string, name: (data.name as string) || name, durationSec, mimeType: file.type });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Voice note upload failed.");
    }
  };

  const stop = async (cancelled: boolean) => {
    const rec = recorderRef.current;
    if (!rec || state !== "recording") return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    // All data events (including the final flush) flow into chunksRef.
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" }));
    });
    try {
      rec.stop();
    } catch {
      return fail("Could not finish the recording.");
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (cancelled) {
      chunksRef.current = [];
      setState("idle");
      setElapsed(0);
      return;
    }
    const blob = await done;
    if (!blob.size) return fail("Empty recording — try again.");
    await uploadBlob(blob, durationSec);
  };

  if (!supported) return null;

  if (state === "recording") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-error/40 bg-error-bg py-1.5 pl-3 pr-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-error" />
        <span className="font-mono text-xs font-semibold text-error">{formatVoiceDuration(elapsed)}</span>
        <button
          type="button"
          onClick={() => void stop(true)}
          aria-label="Discard recording"
          title="Discard"
          className="grid h-8 w-8 place-items-center rounded-full text-error transition hover:bg-error/10"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void stop(false)}
          aria-label="Stop and attach voice note"
          title="Stop & attach"
          className="grid h-8 w-8 place-items-center rounded-full bg-ink text-white transition hover:bg-charcoal"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </span>
    );
  }

  if (state === "uploading") {
    return (
      <span className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-hairline bg-fog px-4 font-mono text-xs text-steel">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-steel/30 border-t-ink" />
        Uploading…
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      aria-label="Record a voice note"
      title="Record a voice note"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-hairline bg-canvas text-steel transition hover:border-ink hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <path d="M12 18v4" />
      </svg>
    </button>
  );
}
