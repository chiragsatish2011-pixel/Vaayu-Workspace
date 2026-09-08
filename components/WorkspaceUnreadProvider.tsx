"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { hasUnseen, getLastSeen, markPanelSeen, type PanelKey } from "@/lib/workspaceUnread";

type UnreadMap = Record<PanelKey, { has: boolean; count?: number }>;

const defaultMap: UnreadMap = {
  chat: { has: false },
  checkpoints: { has: false },
  projects: { has: false },
  files: { has: false },
  dashboard: { has: false },
  settings: { has: false },
};

const Ctx = createContext<{ unread: UnreadMap; refresh: () => void; markSeen: (p: PanelKey) => void }>({
  unread: defaultMap,
  refresh: () => {},
  markSeen: () => {},
});

export function useWorkspaceUnread() {
  return useContext(Ctx);
}

export function WorkspaceUnreadProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState<UnreadMap>(defaultMap);
  const lastChatCount = useRef(0);

  const fetchAll = useCallback(async () => {
    const next: UnreadMap = { ...defaultMap };
    // Chat: use server unreadCount (truth)
    try {
      const res = await fetch("/api/chat/conversations", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.conversations)) {
        const total = (data.conversations as Array<{ unreadCount: number }>).reduce((n, c) => n + (c.unreadCount || 0), 0);
        next.chat = { has: total > 0, count: total };
        lastChatCount.current = total;
        // In-app + browser notification for chat when not viewing chat and has new
        // (document.hidden or not on /chat) — handled here so it works workspace-wide, not just inside ChatManager
        if (total > 0) {
          try {
            const onChatPage = window.location.pathname.startsWith("/chat");
            const shouldNotify = document.hidden || !onChatPage;
            if (shouldNotify && Notification.permission === "granted") {
              const { getChatAppEnabled, triggerChatNotification } = await import("@/lib/chatNotifications");
              // Only if user enabled chat notifications (default is permission-granted)
              const enabled = getChatAppEnabled();
              if (enabled) {
                const latest = (data.conversations as any[]).find((c) => c.unreadCount > 0);
                const title = `New message${total > 1 ? `s (${total})` : ""}`;
                const body = latest?.lastMessage?.content ? `${latest.lastMessage.displayName || latest.lastMessage.userEmail}: ${String(latest.lastMessage.content).slice(0, 80)}` : "You have unread messages";
                triggerChatNotification({ title, body, tag: "vaayu-chat-unread" });
                // Also dispatch in-app event so any toast can show
                window.dispatchEvent(new CustomEvent("vaayu:chat-unread", { detail: { total } }));
              }
            }
          } catch {}
        }
      }
    } catch {}

    // Checkpoints: latest createdAt vs lastSeen
    try {
      const res = await fetch("/api/checkpoints", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      const list: Array<{ createdAt: string }> = Array.isArray(data?.checkpoints) ? data.checkpoints : Array.isArray(data) ? data : [];
      const latest = list[0]?.createdAt ?? null;
      next.checkpoints = { has: hasUnseen(latest, "checkpoints"), count: list.length > 0 ? 1 : 0 };
    } catch {}

    // Projects: latest createdAt
    try {
      const res = await fetch("/api/projects?limit=1", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      const list: Array<{ createdAt: string }> = Array.isArray(data?.projects) ? data.projects : [];
      const latest = list[0]?.createdAt ?? null;
      next.projects = { has: hasUnseen(latest, "projects") };
    } catch {}

    // Files: latest file modifiedTime via browse (lightweight root list)
    try {
      const rootRes = await fetch("/api/drive/root", { cache: "no-store" });
      const rootData = await rootRes.json().catch(() => null);
      const rootId = rootData?.id;
      if (rootId) {
        const res = await fetch(`/api/drive/list?folderId=${encodeURIComponent(rootId)}`, { cache: "no-store" });
        // Fallback: try browse with limit 1 if list not available
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const files: Array<{ modifiedTime?: string }> = Array.isArray(data?.files) ? data.files : [];
          const latest = files[0]?.modifiedTime ?? null;
          next.files = { has: hasUnseen(latest, "files") };
        } else {
          // try browse
          const bRes = await fetch(`/api/drive/browse?id=${encodeURIComponent(rootId)}`, { cache: "no-store" });
          const bData = await bRes.json().catch(() => null);
          const files: Array<{ modifiedTime?: string }> = Array.isArray(bData?.files) ? bData.files : [];
          const latest = files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())[0]?.modifiedTime ?? null;
          next.files = { has: hasUnseen(latest, "files") };
        }
      }
    } catch {
      // files unseen stays false on error
    }

    setUnread(next);
  }, []);

  useEffect(() => {
    void fetchAll();
    const iv = setInterval(fetchAll, 30000);
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchAll();
    };
    const onFocus = () => void fetchAll();
    const onCustom = () => void fetchAll();
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("vaayu:chat-unread", onCustom as EventListener);
    // Also refresh when user navigates (popstate)
    window.addEventListener("popstate", onVis);
    return () => {
      clearInterval(iv);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("vaayu:chat-unread", onCustom as EventListener);
      window.removeEventListener("popstate", onVis);
    };
  }, [fetchAll]);

  const markSeen = useCallback((panel: PanelKey) => {
    markPanelSeen(panel);
    setUnread((prev) => ({ ...prev, [panel]: { has: false } }));
  }, []);

  const value = useMemo(() => ({ unread, refresh: fetchAll, markSeen }), [unread, fetchAll, markSeen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
