"use client";

import { useEffect, useRef, useState } from "react";

type CallType = "voice" | "video";

interface DailyCallFrameProps {
  url: string;
  type: CallType;
  displayName: string;
  onLeave: () => void;
  onError?: (msg: string) => void;
}

/**
 * Embeddable Daily.co call via daily-js `createFrame`.
 * - Voice: startVideoOff, audio-only tile, screen share still available
 * - Video: standard grid, active-speaker highlight
 * - Low-latency screen share: `getDisplayMedia` high frameRate (30) is handled
 *   by Daily's native screen-share (WebRTC) — we just expose the button.
 * - Zoom-grade: SFU+simulcast+adaptive bitrate is server-side (Daily SFU);
 *   client enables talk detection + network UI + reconnect handling.
 * - Theming matches Vaayu design system (ink, canvas, hairline) via Daily's
 *   `customTrayButtons` and `theme` where supported, plus our own chrome.
 */
export function DailyCallFrame({ url, type, displayName, onLeave, onError }: DailyCallFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<unknown>(null);
  const [status, setStatus] = useState<"joining" | "joined" | "reconnecting" | "error">("joining");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(type === "voice");
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let callObject: unknown = null;

    async function join() {
      try {
        const DailyIframe = (await import("@daily-co/daily-js")).default as unknown as {
          createFrame: (el: HTMLElement, opts: Record<string, unknown>) => {
            join: (opts: Record<string, unknown>) => Promise<void>;
            leave: () => Promise<void>;
            destroy: () => void;
            on: (ev: string, cb: (...args: unknown[]) => void) => void;
            off: (ev: string, cb: (...args: unknown[]) => void) => void;
            setLocalVideo: (on: boolean) => void;
            setLocalAudio: (on: boolean) => void;
            startScreenShare: () => void;
            stopScreenShare: () => void;
            participants: () => Record<string, { audio?: boolean; video?: boolean; screen?: boolean; user_name?: string }>;
          };
        };

        if (!containerRef.current || cancelled) return;

        // Create frame fills container — Daily's prebuilt handles layout, we theme it
        const frame = DailyIframe.createFrame(containerRef.current, {
          iframeStyle: {
            width: "100%",
            height: "100%",
            border: "0",
            borderRadius: "16px",
            background: "transparent",
          },
          showLeaveButton: false,
          showFullscreenButton: false,
          // Theming to match Vaayu (ink/canvas) — Daily supports `theme` with custom colors
          theme: {
            colors: {
              accent: "#0a0a0a",
              accentText: "#ffffff",
              background: "#ffffff",
              backgroundAccent: "#f7f8f9",
              baseText: "#0a0a0a",
              border: "#e7e5e4",
              mainAreaBg: "#ffffff",
              mainAreaBgAccent: "#f7f8f9",
              mainAreaText: "#0a0a0a",
              supportiveText: "#78716c",
            },
          } as unknown,
        });

        callRef.current = frame;

        // Event wiring — keep UI in sync, surface reconnecting state
        const onJoined = () => {
          if (!cancelled) setStatus("joined");
        };
        const onLeft = () => {
          if (!cancelled) onLeave();
        };
        const onErrorEv = (ev: unknown) => {
          const msg = (ev as { errorMsg?: string })?.errorMsg || "Call error";
          if (!cancelled) {
            setErrorMsg(msg);
            setStatus("error");
            onError?.(msg);
          }
        };
        const onParticipantJoined = () => {
          // Could trigger active-speaker refresh
        };
        const onActiveSpeakerChange = (ev: unknown) => {
          const e = ev as { activeSpeaker?: { peerId?: string } };
          if (e?.activeSpeaker?.peerId) setActiveSpeaker(e.activeSpeaker.peerId);
          else setActiveSpeaker(null);
        };
        const onNetworkReconnection = () => setStatus("reconnecting");
        const onNetworkReconnected = () => setStatus("joined");
        const onAppMessage = (ev: unknown) => {
          // Listen for screen share start/stop if needed
        };

        frame.on("joined-meeting", onJoined);
        frame.on("left-meeting", onLeft);
        frame.on("error", onErrorEv);
        frame.on("participant-joined", onParticipantJoined);
        frame.on("active-speaker-change", onActiveSpeakerChange);
        frame.on("network-reconnection", onNetworkReconnection);
        frame.on("network-reconnected", onNetworkReconnected);

        // Join with per-type video default + user name
        // For voice, start with video off but allow turning on; Daily's
        // `startVideoOff` is set via room properties, but we also enforce here
        await frame.join({
          url,
          userName: displayName,
          startVideoOff: type === "voice",
          startAudioOff: false,
        });

        // Post-join, ensure correct initial state
        if (type === "voice") {
          // Voice is audio-only by default — ensure video is off
          try {
            frame.setLocalVideo(false);
          } catch {}
          setIsVideoOff(true);
        }

        callObject = frame;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not join call. Check camera/mic permissions.";
        if (!cancelled) {
          setErrorMsg(msg);
          setStatus("error");
          onError?.(msg);
        }
      }
    }

    void join();

    return () => {
      cancelled = true;
      try {
        const frame = callObject as {
          leave?: () => Promise<void>;
          destroy?: () => void;
          off?: (ev: string, cb: (...args: unknown[]) => void) => void;
        } | null;
        if (frame?.leave) void frame.leave().catch(() => {});
        if (frame?.destroy) frame.destroy();
      } catch {}
    };
  }, [url, type, displayName, onLeave, onError]);

  const toggleMute = async () => {
    const frame = callRef.current as { setLocalAudio?: (on: boolean) => void } | null;
    if (!frame?.setLocalAudio) return;
    try {
      frame.setLocalAudio(isMuted);
      setIsMuted(!isMuted);
    } catch {}
  };

  const toggleVideo = async () => {
    const frame = callRef.current as { setLocalVideo?: (on: boolean) => void } | null;
    if (!frame?.setLocalVideo) return;
    try {
      frame.setLocalVideo(isVideoOff);
      setIsVideoOff(!isVideoOff);
    } catch {}
  };

  const toggleScreenShare = async () => {
    const frame = callRef.current as {
      startScreenShare?: () => void;
      stopScreenShare?: () => void;
    } | null;
    if (!frame) return;
    try {
      if (isScreenSharing) {
        frame.stopScreenShare?.();
        setIsScreenSharing(false);
      } else {
        // Daily will trigger browser's getDisplayMedia picker (screen/window/tab)
        // with low-latency encoding (30fps, adaptive bitrate)
        frame.startScreenShare?.();
        setIsScreenSharing(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Screen share failed — check permission.";
      setErrorMsg(msg);
    }
  };

  const leave = async () => {
    const frame = callRef.current as { leave?: () => Promise<void>; destroy?: () => void } | null;
    try {
      if (frame?.leave) await frame.leave();
      if (frame?.destroy) frame.destroy();
    } catch {}
    onLeave();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-lg">
      {/* Top bar — Vaayu chrome, not Daily's default */}
      <div className="flex items-center justify-between border-b border-hairline-soft bg-fog/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${type === "voice" ? "bg-ink text-white" : "bg-[#0e7a64] text-white"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === "joined" ? "bg-emerald-400 animate-pulse" : status === "reconnecting" ? "bg-amber-400 animate-pulse" : "bg-white/60"}`} />
            {type === "voice" ? "Voice" : "Video"} {status === "reconnecting" ? "· Reconnecting…" : ""}
          </span>
          {activeSpeaker && <span className="hidden sm:inline text-xs text-steel">Speaking: {activeSpeaker.slice(0, 8)}…</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={toggleMute} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isMuted ? "bg-error text-white" : "bg-canvas border border-hairline hover:border-ink"}`}>
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button onClick={toggleVideo} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isVideoOff ? "bg-canvas border border-hairline" : "bg-ink text-white"}`}>
            {isVideoOff ? "Camera on" : "Camera off"}
          </button>
          <button onClick={toggleScreenShare} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isScreenSharing ? "bg-amber-500 text-white" : "bg-canvas border border-hairline hover:border-ink"}`} title="Share screen — pick window/tab, low-latency">
            {isScreenSharing ? "Stop share" : "Share screen"}
          </button>
          <button onClick={leave} className="rounded-full bg-error px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
            Leave
          </button>
        </div>
      </div>

      {/* Daily iframe container — fills remaining space */}
      <div className="relative flex-1 bg-ink/5">
        <div ref={containerRef} className="absolute inset-0" />

        {status === "joining" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas/80 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-ink border-t-transparent" />
              <p className="mt-3 text-sm font-medium text-ink">Joining {type} call…</p>
              <p className="mt-1 text-xs text-steel">Grant camera/mic if prompted</p>
            </div>
          </div>
        )}
        {status === "reconnecting" && (
          <div className="absolute inset-0 grid place-items-center bg-amber-50/90 backdrop-blur-sm">
            <p className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white">Reconnecting…</p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center bg-canvas p-6">
            <div className="max-w-sm rounded-2xl border border-hairline bg-amber-50 p-5 text-center">
              <p className="text-sm font-semibold text-amber-900">Couldn’t join call</p>
              <p className="mt-1 text-xs text-steel">{errorMsg || "Check camera/mic permissions and try again."}</p>
              <button onClick={onLeave} className="mt-4 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">
                Back to Calls
              </button>
            </div>
          </div>
        )}

        {/* Voice-only overlay: when no video tiles, show audio-focused participant list */}
        {type === "voice" && status === "joined" && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-ink/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm">
            Voice call — screen share available
          </div>
        )}
      </div>

      {/* Bottom hint for screen share latency test */}
      <div className="border-t border-hairline-soft bg-fog/30 px-4 py-2 text-center font-mono text-[11px] text-steel">
        {isScreenSharing ? "Sharing screen — others see it in real time (low-latency)" : "Tip: Share screen while typing/scrolling to test smoothness — Daily uses WebRTC getDisplayMedia"}
      </div>
    </div>
  );
}
