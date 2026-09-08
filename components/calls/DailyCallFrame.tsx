"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DailyProvider,
  DailyVideo,
  DailyAudio,
  useDaily,
  useDailyError,
  useMeetingState,
  useParticipantIds,
  useLocalParticipant,
  useActiveSpeakerId,
  useScreenShare,
  useParticipant,
} from "@daily-co/daily-react";

type CallType = "voice" | "video";

interface DailyCallFrameProps {
  url: string;
  type: CallType;
  displayName: string;
  onLeave: () => void;
  onError?: (msg: string) => void;
}

/**
 * Public wrapper — owns the Daily call object lifecycle via DailyProvider.
 * This prevents "Duplicate DailyIframe instances" by letting daily-react
 * deduplicate and clean up the instance (including React Strict Mode double-mount).
 * The url is passed to the provider's factory options; the inner component
 * handles join/leave/error cleanup explicitly.
 */
export function DailyCallFrame(props: DailyCallFrameProps) {
  // Key forces a fresh provider when the room URL changes — avoids stale
  // instances when switching calls quickly (rapid re-use scenario).
  return (
    <DailyProvider key={props.url} url={props.url}>
      <DailyCallInner {...props} />
    </DailyProvider>
  );
}

/* ───────── Inner call UI (inside provider) ───────── */

function DailyCallInner({ url, type, displayName, onLeave, onError }: DailyCallFrameProps) {
  const callObject = useDaily();
  const meetingState = useMeetingState();
  const { meetingError } = useDailyError();
  const localParticipant = useLocalParticipant();
  const participantIds = useParticipantIds();
  const activeSpeakerId = useActiveSpeakerId();
  const { isSharingScreen, screens, startScreenShare, stopScreenShare } = useScreenShare();

  const localId = (localParticipant as unknown as { session_id?: string } | null)?.session_id ?? "local";
  // Stabilize callback refs to avoid join effect re-triggering
  const onLeaveRef = useRef(onLeave);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const remoteIds = useMemo(
    () => participantIds.filter((id) => id !== localId && id !== "local"),
    [participantIds, localId]
  );

  // Leave + cleanup — called from UI and from error paths. Provider will destroy on unmount.
  const handleLeave = useCallback(async () => {
    try {
      if (callObject && meetingState !== "left-meeting" && meetingState !== "new") {
        await callObject.leave();
      }
    } catch {
      // ignore leave errors during cleanup
    } finally {
      onLeaveRef.current();
    }
  }, [callObject, meetingState]);

  // ── Join logic: only when meetingState is 'new', avoids double-join in StrictMode
  const hasAttemptedJoin = useRef(false);
  const [joinErrorLocal, setJoinErrorLocal] = useState<string | null>(null);

  useEffect(() => {
    if (!callObject) return;
    if (meetingState !== "new") return;
    if (hasAttemptedJoin.current) return;
    hasAttemptedJoin.current = true;
    // Join with per-type video default + display name
    callObject
      .join({
        url,
        userName: displayName,
        startVideoOff: type === "voice",
        startAudioOff: false,
      })
      .catch((err: unknown) => {
        const msg =
          (err as { errorMsg?: string })?.errorMsg ||
          (err instanceof Error ? err.message : null) ||
          "Could not join call. Check your connection and try again.";
        setJoinErrorLocal(msg);
        onErrorRef.current?.(msg);
        // Cleanup dangling resources so a retry doesn't hit duplicate-instance
        try {
          callObject.leave().catch(() => {});
        } catch {}
      });
    // Note: callObject is stable from provider; intentionally not including it in dep array beyond guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callObject, meetingState, url, displayName, type]);

  // ── Fatal error cleanup: when daily reports a fatal error or meetingState becomes 'error',
  // explicitly leave before showing calm error UI. Ensures no dangling instance blocks next join.
  useEffect(() => {
    if (!callObject) return;
    if (meetingState === "error" || meetingError) {
      const msg =
        meetingError?.errorMsg ||
        (meetingError as unknown as { error?: string } | null)?.error ||
        joinErrorLocal ||
        "Could not join call. Check camera/mic permissions and try again.";
      // Ensure cleanup happens regardless of whether user clicks "Back"
      callObject.leave().catch(() => {});
      if (!joinErrorLocal) setJoinErrorLocal(msg);
      onErrorRef.current?.(msg);
    }
  }, [meetingState, meetingError, callObject, joinErrorLocal]);

  // ── Local derived states for controls (synced to track state when possible)
  const localVideoState = (localParticipant as unknown as { tracks?: { video?: { state?: string } } } | null)?.tracks?.video?.state;
  const localAudioState = (localParticipant as unknown as { tracks?: { audio?: { state?: string } } } | null)?.tracks?.audio?.state;
  const isVideoOff = localVideoState ? localVideoState !== "playable" : type === "voice" ? true : false;
  const isMuted = localAudioState ? localAudioState !== "playable" && localAudioState !== "sendable" : false;

  const [viewMode, setViewMode] = useState<"gallery" | "speaker">("gallery");
  const [showSelf, setShowSelf] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const isJoined = meetingState === "joined-meeting";
  const isJoining = meetingState === "new" || meetingState === "loading" || meetingState === "joining-meeting" || meetingState === "loaded";
  const hasError = !!meetingError || !!joinErrorLocal || meetingState === "error";
  const hasScreenShare = screens.length > 0;
  const errorMsg = joinErrorLocal || meetingError?.errorMsg || "Could not join call.";

  // Auto-switch to speaker view when participant count grows (makes the UI feel adaptive)
  useEffect(() => {
    if (remoteIds.length >= 5 && viewMode === "gallery") {
      // keep gallery as default for small calls; don't force, just offer — no auto switch to avoid surprising user
    }
  }, [remoteIds.length, viewMode]);

  // Auto-hide control bar during active call
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (!isJoined || hasError) {
      setControlsVisible(true);
      return;
    }
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800) as unknown as number;
  }, [isJoined, hasError]);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const onContainerMove = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const toggleMute = useCallback(() => {
    if (!callObject) return;
    try {
      // isMuted === true means audio is off → pass true to turn on
      callObject.setLocalAudio(isMuted);
    } catch {}
  }, [callObject, isMuted]);

  const toggleVideo = useCallback(() => {
    if (!callObject) return;
    try {
      callObject.setLocalVideo(isVideoOff);
    } catch {}
  }, [callObject, isVideoOff]);

  const toggleScreen = useCallback(() => {
    try {
      if (isSharingScreen) stopScreenShare();
      else startScreenShare();
    } catch {}
  }, [isSharingScreen, startScreenShare, stopScreenShare]);

  // ── Render helpers
  const participantCount = participantIds.length; // includes local when joined
  const displayCount = isJoined ? participantCount : Math.max(1, participantCount);

  return (
    <div
      onMouseMove={onContainerMove}
      onClick={onContainerMove}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#222] bg-[#0a0a0a] shadow-xl"
    >
      {/* Top meta bar — minimal, only when controls visible, hides with controls during active call */}
      <div
        className={`flex items-center justify-between border-b border-white/[0.08] bg-[#111214] px-4 py-2.5 transition-all duration-300 ${
          !controlsVisible && isJoined && !hasError ? "-translate-y-full opacity-0 pointer-events-none h-0 py-0 overflow-hidden border-0" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${type === "voice" ? "bg-white text-[#0a0a0a]" : "bg-[#1a9a84] text-white"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isJoined ? "bg-emerald-300 animate-pulse" : hasError ? "bg-white/40" : "bg-white/60"}`} />
            {type === "voice" ? "Voice" : "Video"}
          </span>
          {isJoined && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/60">
              <span className="h-1 w-1 rounded-full bg-white/30" />
              {displayCount} {displayCount === 1 ? "participant" : "participants"}
              {hasScreenShare && <span className="ml-1 inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Screen sharing</span>}
            </span>
          )}
          {hasError && <span className="text-xs text-white/50">Connection error</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {isJoined && remoteIds.length > 1 && !hasScreenShare && (
            <button
              onClick={() => setViewMode((v) => (v === "gallery" ? "speaker" : "gallery"))}
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
              title={viewMode === "gallery" ? "Switch to Speaker view" : "Switch to Gallery view"}
            >
              {viewMode === "gallery" ? "Speaker view" : "Gallery view"}
            </button>
          )}
          <button
            onClick={() => setShowSelf((v) => !v)}
            className="hidden sm:inline-flex rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white hover:border-white/20"
          >
            {showSelf ? "Hide self" : "Show self"}
          </button>
        </div>
      </div>

      {/* Main call area — dark backdrop to make video the focus */}
      <div className="relative flex-1 overflow-hidden bg-[#0d0f12]">
        {/* Screen-share layout */}
        {hasScreenShare ? (
          <div className="absolute inset-0 flex flex-col">
            {/* Screen content — dominant */}
            <div className="relative flex-1 overflow-hidden bg-black">
              {screens.map((s) => (
                <ScreenShareTile key={s.screenId} screen={s} />
              ))}
              {isSharingScreen && (
                <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-[#0a0a0a]/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-md border border-white/10">
                  You are sharing your screen
                  <button onClick={toggleScreen} className="ml-3 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-white/90">
                    Stop sharing
                  </button>
                </div>
              )}
            </div>
            {/* Participant strip */}
            <div className="flex h-[112px] sm:h-[132px] shrink-0 items-center gap-2 overflow-x-auto border-t border-white/[0.06] bg-[#111214] p-2">
              {showSelf && localParticipant && (
                <div className="h-full w-[160px] shrink-0">
                  <ParticipantTile sessionId={localId} isLocal isActiveSpeaker={activeSpeakerId === localId} compact />
                </div>
              )}
              {remoteIds.map((id) => (
                <div key={id} className="h-full w-[160px] shrink-0">
                  <ParticipantTile sessionId={id} isActiveSpeaker={activeSpeakerId === id} compact />
                </div>
              ))}
              {remoteIds.length === 0 && !showSelf && (
                <div className="flex h-full w-full items-center justify-center text-xs text-white/50">Waiting for others… your screen is visible to anyone who joins</div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Gallery / Speaker layouts */}
            {remoteIds.length === 0 && isJoined ? (
              // Waiting state — self-view visible so user isn't staring at void
              <div className="absolute inset-0 grid place-items-center p-6">
                <div className="text-center">
                  <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-[#1a1d21] border border-white/10 shadow-lg">
                    <span className="text-2xl font-semibold text-white/80">{initials(displayName)}</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-white">Waiting for others to join</p>
                  <p className="mt-1 text-xs text-white/50">You’re in the room. Others can join from Calls or the invite link.</p>
                  {showSelf && localParticipant && (
                    <div className="mx-auto mt-6 w-[220px]">
                      <ParticipantTile sessionId={localId} isLocal isActiveSpeaker={false} />
                      <p className="mt-2 text-[11px] text-white/40">Your camera preview — others will see you like this</p>
                    </div>
                  )}
                </div>
              </div>
            ) : viewMode === "speaker" && remoteIds.length > 1 ? (
              <SpeakerView remoteIds={remoteIds} localId={localId} showSelf={showSelf} activeSpeakerId={activeSpeakerId} isJoined={isJoined} />
            ) : (
              <GalleryGrid remoteIds={remoteIds} activeSpeakerId={activeSpeakerId} isJoined={isJoined} showSelfOverlay={showSelf} localId={localId} displayName={displayName} />
            )}
            {/* Floating self-view thumbnail when not in screen-share and not showing waiting, as distinct bottom-right tile if showSelf and not already in grid — mirrors Zoom/Teams */}
            {showSelf && isJoined && remoteIds.length > 0 && !hasScreenShare && viewMode === "gallery" && (
              <div className="absolute bottom-3 right-3 z-10 w-[132px] sm:w-[168px] overflow-hidden rounded-xl border border-white/15 bg-[#1a1d21] shadow-xl">
                <div className="relative aspect-video">
                  <ParticipantTile sessionId={localId} isLocal isActiveSpeaker={activeSpeakerId === localId} compact hideName />
                  <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">You</span>
                </div>
              </div>
            )}
            {showSelf && isJoined && remoteIds.length > 0 && !hasScreenShare && viewMode === "speaker" && (
              // In speaker view, self is already in strip if needed — no extra floating needed to avoid duplicate
              null
            )}
          </>
        )}

        {/* Audio — global active-speaker audio (DailyAudio is not per-participant) */}
        <DailyAudio />
        {/* Fallback for local echo not needed */}

        {/* Joining — clean, calm spinner with room name */}
        {isJoining && !hasError && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d0f12]/95 backdrop-blur-sm p-6">
            <div className="text-center">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="mt-4 text-sm font-semibold text-white">Connecting…</p>
              <p className="mt-1 text-xs text-white/50">{displayName ? `Joining as ${displayName}` : "Joining call"}</p>
            </div>
          </div>
        )}

        {/* Reconnecting — subtle top pill, not full-screen amber */}
        {isJoined && meetingState !== "joined-meeting" && meetingState !== "new" && !hasError && !isJoining && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Reconnecting…
            </span>
          </div>
        )}

        {/* Error — calm, intentional error screen (not yellow alert box), consistent with app conventions */}
        {hasError && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d0f12] p-6">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white p-6 text-center shadow-xl">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#f3f4f6] text-ink">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-ink">
                  <path d="M12 8v5m0 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">Couldn’t join call</p>
              <p className="mt-1 text-xs leading-relaxed text-steel line-clamp-3">{errorMsg}</p>
              <button onClick={handleLeave} className="mt-4 w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal">
                Back to Calls
              </button>
              <p className="mt-2 text-[11px] text-stone">The call was cleaned up — you can try again.</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom control bar — auto-hiding during active call, always visible while joining/error */}
      <div
        className={`border-t border-white/[0.06] bg-[#111214] px-3 py-3 sm:px-4 transition-all duration-300 ${
          !controlsVisible && isJoined && !hasError ? "translate-y-full opacity-0 pointer-events-none h-0 py-0 overflow-hidden border-0" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-2">
          <ControlButton active={!isMuted} onClick={toggleMute} label={isMuted ? "Unmute" : "Mute"} icon={isMuted ? "🔇" : "🎙"} tone={isMuted ? "danger" : "default"} />
          <ControlButton active={!isVideoOff} onClick={toggleVideo} label={isVideoOff ? "Camera on" : "Camera off"} icon={isVideoOff ? "🚫" : "📷"} />
          <ControlButton active={isSharingScreen} onClick={toggleScreen} label={isSharingScreen ? "Stop share" : "Share screen"} icon="🖥" tone={isSharingScreen ? "active" : "default"} />
          <div className="mx-2 h-6 w-px bg-white/10" />
          <button
            onClick={handleLeave}
            className="inline-flex items-center gap-2 rounded-full bg-[#e5484d] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#d93d42]"
          >
            <span className="hidden sm:inline">Leave</span>
            <span className="sm:hidden">✕</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Tiles ───────── */

function ParticipantTile({
  sessionId,
  isLocal,
  isActiveSpeaker,
  compact,
  hideName,
}: {
  sessionId: string;
  isLocal?: boolean;
  isActiveSpeaker: boolean;
  compact?: boolean;
  hideName?: boolean;
}) {
  const p = useParticipant(sessionId);
  // Fallbacks when participant data not yet available (pre-join, or remote not subscribed)
  const name = (p as unknown as { user_name?: string } | null)?.user_name || (isLocal ? "You" : "Guest");
  const videoState = (p as unknown as { tracks?: { video?: { state?: string } } } | null)?.tracks?.video?.state;
  const audioState = (p as unknown as { tracks?: { audio?: { state?: string; blocked?: unknown; off?: unknown } } } | null)?.tracks?.audio?.state;
  const isVideoPlayable = videoState === "playable";
  const isMuted = audioState !== "playable" && audioState !== "sendable"; // muted or blocked/interrupted
  const initialsText = initials(name);

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-[#1a1d21] shadow-sm ${
        isActiveSpeaker ? "ring-2 ring-emerald-400/70 shadow-[0_0_20px_rgba(16,185,129,0.22)]" : "ring-1 ring-white/10"
      } ${compact ? "border-0" : "border border-white/[0.06]"}`}
    >
      {/* Video or avatar */}
      <div className="relative flex-1 overflow-hidden bg-[#121417]">
        {isVideoPlayable ? (
          <DailyVideo sessionId={sessionId} type="video" automirror={!!isLocal} fit="cover" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1e2328] to-[#0f1215] p-3">
            <div className="text-center">
              <div className="mx-auto grid h-12 w-12 sm:h-14 sm:w-14 place-items-center rounded-full bg-[#242a30] text-white shadow-inner ring-1 ring-white/10">
                <span className="text-sm font-semibold tracking-wide">{initialsText}</span>
              </div>
              {!compact && <p className="mt-2 text-xs font-medium text-white/70">{name}</p>}
              {!compact && <p className="text-[11px] text-white/40">Camera off</p>}
            </div>
          </div>
        )}
        {/* Speaking pulse bar (subtle) */}
        {isActiveSpeaker && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-emerald-400/90" />
        )}
      </div>
      {/* Name + status overlay — anchored at bottom of tile, not floating elsewhere */}
      {!hideName && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 py-1.5">
          <span className="min-w-0 truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {isLocal ? "You" : name}
          </span>
          <span className="inline-flex items-center gap-1">
            {isMuted && (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[11px] text-white" title="Muted">
                🔇
              </span>
            )}
            {isActiveSpeaker && (
              <span className="h-1.5 w-5 rounded-full bg-emerald-400 animate-pulse" title="Speaking" />
            )}
          </span>
        </div>
      )}
      {/* Local badge */}
      {isLocal && !hideName && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/80">YOU</span>
      )}
    </div>
  );
}

function ScreenShareTile({ screen }: { screen: { screenId: string; session_id: string } }) {
  return (
    <div className="h-full w-full bg-black">
      <DailyVideo sessionId={screen.session_id} type="screenVideo" fit="contain" className="h-full w-full object-contain" />
    </div>
  );
}

function GalleryGrid({
  remoteIds,
  activeSpeakerId,
  isJoined,
  showSelfOverlay,
  localId,
  displayName,
}: {
  remoteIds: string[];
  activeSpeakerId: string | null;
  isJoined: boolean;
  showSelfOverlay: boolean;
  localId: string;
  displayName: string;
}) {
  const count = remoteIds.length;
  // Center the grid, fill space evenly, similar aspect ratios
  const cols =
    count === 0 ? "grid-cols-1" : count === 1 ? "grid-cols-1 max-w-[720px] mx-auto" : count === 2 ? "grid-cols-1 sm:grid-cols-2" : count <= 4 ? "grid-cols-2" : count <= 6 ? "grid-cols-3" : "grid-cols-3 lg:grid-cols-4";
  // Use auto-rows to keep tiles consistent height; gap matches rounded tile gutters
  return (
    <div className="absolute inset-0 overflow-auto p-3 sm:p-4">
      <div className={`grid h-full content-center gap-3 sm:gap-3.5 ${cols} auto-rows-[minmax(0,1fr)]`}>
        {remoteIds.map((id) => (
          <div key={id} className="min-h-[160px] sm:min-h-[180px]">
            <ParticipantTile sessionId={id} isActiveSpeaker={activeSpeakerId === id} />
          </div>
        ))}
        {count === 0 && isJoined && !showSelfOverlay && (
          // Fallback when no remotes and self hidden — still show local as tile so not blank
          <div className="min-h-[220px] max-w-[520px] mx-auto w-full">
            <ParticipantTile sessionId={localId} isLocal isActiveSpeaker={activeSpeakerId === localId} />
            <p className="mt-2 text-center text-xs text-white/40">{displayName ? `You — ${displayName}` : "You"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SpeakerView({
  remoteIds,
  localId,
  showSelf,
  activeSpeakerId,
  isJoined,
}: {
  remoteIds: string[];
  localId: string;
  showSelf: boolean;
  activeSpeakerId: string | null;
  isJoined: boolean;
}) {
  const allIds = showSelf ? [...remoteIds, localId] : [...remoteIds];
  const mainId = (activeSpeakerId && allIds.includes(activeSpeakerId) ? activeSpeakerId : remoteIds[0] ?? localId);
  const stripIds = allIds.filter((id) => id !== mainId);
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex-1 p-3 sm:p-4">
        <div className="h-full w-full overflow-hidden rounded-xl border border-white/10 shadow-lg bg-[#0a0a0a]">
          <ParticipantTile sessionId={mainId} isLocal={mainId === localId} isActiveSpeaker={activeSpeakerId === mainId} />
        </div>
      </div>
      {stripIds.length > 0 && (
        <div className="flex h-[108px] sm:h-[128px] shrink-0 gap-2 overflow-x-auto border-t border-white/[0.06] bg-[#111214] p-2">
          {stripIds.map((id) => (
            <div key={id} className="h-full w-[160px] sm:w-[192px] shrink-0">
              <ParticipantTile sessionId={id} isLocal={id === localId} isActiveSpeaker={activeSpeakerId === id} compact />
            </div>
          ))}
        </div>
      )}
      {stripIds.length === 0 && isJoined && (
        <div className="border-t border-white/[0.06] bg-[#111214] px-4 py-2 text-center text-xs text-white/40">Speaker view — you’re the only other participant</div>
      )}
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  icon,
  active,
  tone = "default",
}: {
  onClick: () => void;
  label: string;
  icon: string;
  active?: boolean;
  tone?: "default" | "danger" | "active";
}) {
  const base = "inline-flex items-center gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold transition-colors";
  const toneCls =
    tone === "danger"
      ? "bg-[#2a1214] text-[#ffb4b8] border border-[#e5484d]/30 hover:bg-[#3a1518]"
      : tone === "active"
        ? "bg-amber-500 text-white border border-amber-400 hover:bg-amber-600"
        : active
          ? "bg-white text-[#0a0a0a] border border-white hover:bg-white/90"
          : "bg-white/10 text-white border border-white/15 hover:bg-white/15";
  return (
    <button onClick={onClick} className={`${base} ${toneCls}`}>
      <span aria-hidden className="text-[14px] leading-none">
        {icon}
      </span>
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden truncate max-w-[52px]">{label.split(" ")[0]}</span>
    </button>
  );
}

function initials(name?: string | null) {
  if (!name || !name.trim()) return "VA";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "VA";
}
