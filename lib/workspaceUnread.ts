/**
 * Workspace-wide unread helpers — research-based approach for “every panel” highlights.
 * - Chat: server truth via unreadCount from /api/chat/conversations (lastReadAt watermark)
 * - Other panels: client lastSeen timestamp vs latest createdAt (localStorage), since no server read watermark exists there.
 * Research: Figma/Notion/Slack all use per-section lastSeen + polling/SSE to show • dot or count without spamming.
 */

export type PanelKey = "chat" | "checkpoints" | "projects" | "files" | "dashboard" | "settings";

const LAST_SEEN_PREFIX = "vaayu:lastSeen:";

export function getLastSeen(panel: PanelKey): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_PREFIX + panel);
    return raw ? new Date(raw).getTime() || 0 : 0;
  } catch {
    return 0;
  }
}

export function setLastSeen(panel: PanelKey, date: Date | string | number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    window.localStorage.setItem(LAST_SEEN_PREFIX + panel, iso);
  } catch {}
}

export function markPanelSeen(panel: PanelKey): void {
  setLastSeen(panel, new Date());
}

export function hasUnseen(latestIso: string | Date | null | undefined, panel: PanelKey): boolean {
  if (!latestIso) return false;
  const latest = new Date(latestIso).getTime();
  if (!Number.isFinite(latest)) return false;
  const seen = getLastSeen(panel);
  // If never seen, treat as not unseen until user visits at least once (avoid flashing everything on first login)
  if (seen === 0) return false;
  return latest > seen + 1000; // 1s grace to avoid race on just-created
}
