/**
 * Daily.co room helpers (SERVER ONLY).
 * One source of truth for Daily room config — voice/video, expiry, SFU/simulcast, etc.
 */

export type CallType = "voice" | "video";
export type CallContext = "standalone" | "project" | "checkpoint";

export interface DailyRoomConfig {
  type: CallType;
  context: CallContext;
  contextId?: string | null;
  createdBy: string;
}

/**
 * Daily room properties tuned for Vaayu — SFU + simulcast + adaptive bitrate
 * + low-latency screen share + active speaker. All via Daily's managed SFU.
 */
export function dailyRoomProperties(type: CallType) {
  const isVoice = type === "voice";
  return {
    // SFU mode — Daily's Selective Forwarding Unit (not P2P) for scale
    sfu_switchover: 2, // switch to SFU at 2 participants
    enable_screenshare: true,
    enable_chat: false,
    enable_knocking: false,
    enable_prejoin_ui: false,
    // Voice vs Video defaults
    start_video_off: isVoice,
    start_audio_off: false,
    // Recording off by default
    enable_recording: false as const,
    eject_at_room_exp: true,
    eject_after_elapsed: 240 * 60, // 4 hours hard cap
    lang: "en",
  };
}

export function dailyRoomNameFor(type: CallType, context: CallContext, contextId?: string | null): string {
  const base = `vaayu-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (context !== "standalone" && contextId) {
    // Keep context in name for debugging, but not as the sole identifier
    return `${base}-${context}-${contextId.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }
  return base.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function isValidDailyRoomName(name: unknown): boolean {
  return typeof name === "string" && /^[a-z0-9-]{3,64}$/.test(name);
}
