"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { formatDateTime } from "@/lib/format";
import { TiptapEditor, renderTiptapJsonToReact } from "@/components/mentions/TiptapEditor";

/* ── Types (mirror the scoped API JSON) ─────────────────────────────── */

export interface ChatMessage {
  id: string;
  conversationId: string | null;
  content: string;
  contentJson?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName: string | null;
  avatarDriveId?: string | null;
}

interface ConvoMember {
  userId: string;
  email: string;
  displayName: string | null;
  avatarDriveId: string | null;
  joinedAt: string;
}

interface ConvoLastMessage {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  userEmail: string;
  displayName: string | null;
}

interface Convo {
  id: string;
  type: "direct" | "group";
  name: string | null;
  createdAt: string;
  updatedAt: string;
  members: ConvoMember[];
  lastMessage: ConvoLastMessage | null;
  unreadCount: number;
}

interface DirectoryUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarDriveId: string | null;
}

interface ChatManagerProps {
  currentUser: { id: string; email: string; displayName?: string | null };
  /** Deep link: preselect this conversation once the list loads (?c=). */
  initialConversationId?: string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function otherMember(c: Convo, selfId: string): ConvoMember | undefined {
  return c.members.find((m) => m.userId !== selfId) ?? c.members[0];
}

function convoTitle(c: Convo, selfId: string): string {
  if (c.type === "group") return c.name || "Unnamed group";
  const o = otherMember(c, selfId);
  return getDisplayName(o?.displayName, o?.email ?? "Unknown");
}

function previewText(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
}

function listTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = startOfToday - 6 * 24 * 3600 * 1000;
  if (d.getTime() >= weekAgo) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

function sortByActivity(list: Convo[]): Convo[] {
  return [...list].sort((a, b) => {
    const at = a.lastMessage?.createdAt ?? a.updatedAt;
    const bt = b.lastMessage?.createdAt ?? b.updatedAt;
    return bt.localeCompare(at);
  });
}

/* ── Component ──────────────────────────────────────────────────────── */

export function ChatManager({ currentUser, initialConversationId }: ChatManagerProps) {
  const router = useRouter();
  const selfId = currentUser.id;
  const deepLinkRef = useRef<string | null>(initialConversationId ?? null);

  const [convos, setConvos] = useState<Convo[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const [threads, setThreads] = useState<Record<string, { messages: ChatMessage[]; hasMore: boolean; loading: boolean }>>({});
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [sending, setSending] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const [streamState, setStreamState] = useState<"live" | "reconnecting">("reconnecting");
  const [typing, setTyping] = useState<Record<string, { userId: string; displayName: string }[]>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const lastTypingSent = useRef<Record<string, number>>({});

  /* ── Conversation list ── */

  const fetchConvos = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/conversations", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load chats.");
      const list: Convo[] = Array.isArray(data?.conversations) ? data.conversations : [];
      setConvos(sortByActivity(list));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load chats.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchConvos();
  }, [fetchConvos]);

  /* ── Thread loading ── */

  const loadThread = useCallback(async (conversationId: string, before?: string) => {
    setThreads((prev) => ({
      ...prev,
      [conversationId]: { messages: before ? (prev[conversationId]?.messages ?? []) : [], hasMore: before ? (prev[conversationId]?.hasMore ?? true) : true, loading: true },
    }));
    setThreadError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load messages.");
      const msgs: ChatMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setThreads((prev) => {
        const existing = before ? (prev[conversationId]?.messages ?? []) : [];
        const merged = before ? [...msgs, ...existing] : msgs;
        const seen = new Set<string>();
        const deduped = merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
        return { ...prev, [conversationId]: { messages: deduped, hasMore: Boolean(data?.hasMore), loading: false } };
      });
    } catch (e) {
      setThreads((prev) => ({ ...prev, [conversationId]: { messages: prev[conversationId]?.messages ?? [], hasMore: false, loading: false } }));
      setThreadError(e instanceof Error ? e.message : "Failed to load messages.");
    }
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    setConvos((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)));
    try {
      await fetch(`/api/chat/conversations/${conversationId}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      // Watermark is best-effort; badge already cleared locally.
    }
  }, []);

  const selectConversation = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setGroupInfoOpen(false);
      setDraft(null);
      setEditorKey((k) => k + 1);
      setAutoScroll(true);
      if (id) {
        setThreads((prev) => (prev[id] ? prev : { ...prev, [id]: { messages: [], hasMore: true, loading: true } }));
        void loadThread(id);
        void markRead(id);
      }
    },
    [loadThread, markRead]
  );

  // Deep link (?c=): preselect once the list arrives, then forget it.
  useEffect(() => {
    const id = deepLinkRef.current;
    if (!id || loadingList || selectedIdRef.current) return;
    deepLinkRef.current = null;
    if (convos.some((c) => c.id === id)) selectConversation(id);
  }, [convos, loadingList, selectConversation]);

  /* ── Real-time push: ONE EventSource, zero polling ── */

  useEffect(() => {
    const es = new EventSource("/api/chat/stream");

    const onOpen = () => {
      setStreamState("live");
      // Heal anything missed while disconnected.
      void fetchConvos();
      const current = selectedIdRef.current;
      if (current) void loadThread(current);
    };
    const onError = () => {
      // EventSource retries automatically with backoff.
      setStreamState("reconnecting");
    };

    const upsertConvoPreview = (conversationId: string, message: ChatMessage) => {
      setConvos((prev) => {
        const found = prev.find((c) => c.id === conversationId);
        const isViewing = selectedIdRef.current === conversationId;
        if (!found) {
          // Unknown conversation (e.g. just added) — refresh the list.
          void fetchConvos();
          return prev;
        }
        const updated: Convo = {
          ...found,
          updatedAt: message.createdAt,
          lastMessage: {
            id: message.id,
            content: message.content,
            createdAt: message.createdAt,
            userId: message.userId,
            userEmail: message.userEmail,
            displayName: message.displayName,
          },
          unreadCount: isViewing || message.userId === selfId ? found.unreadCount : found.unreadCount + 1,
        };
        return sortByActivity(prev.map((c) => (c.id === conversationId ? updated : c)));
      });
    };

    es.onopen = onOpen;
    es.onerror = onError;

    es.addEventListener("message.created", ((ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { conversationId: string; message: ChatMessage };
        const { conversationId, message } = data;
        if (!conversationId || !message) return;
        upsertConvoPreview(conversationId, message);
        if (selectedIdRef.current === conversationId) {
          setThreads((prev) => {
            const thread = prev[conversationId] ?? { messages: [], hasMore: false, loading: false };
            if (thread.messages.some((m) => m.id === message.id)) return prev;
            return { ...prev, [conversationId]: { ...thread, messages: [...thread.messages, message] } };
          });
          if (message.userId !== selfId) void markRead(conversationId);
        }
      } catch {
        // Malformed push — next reconnect heals via refetch.
      }
    }) as EventListener);

    const refreshList = () => void fetchConvos();
    es.addEventListener("conversation.created", refreshList as EventListener);
    es.addEventListener("members.added", ((ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { conversationId: string };
        void fetchConvos();
        if (data?.conversationId && selectedIdRef.current === data.conversationId) void loadThread(data.conversationId);
      } catch {
        void fetchConvos();
      }
    }) as EventListener);
    es.addEventListener("members.removed", ((ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { conversationId: string };
        void fetchConvos();
        if (data?.conversationId && selectedIdRef.current === data.conversationId) void loadThread(data.conversationId);
      } catch {
        void fetchConvos();
      }
    }) as EventListener);
    es.addEventListener("conversation.deleted", ((ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { conversationId: string };
        if (data?.conversationId) {
          setConvos((prev) => prev.filter((c) => c.id !== data.conversationId));
          if (selectedIdRef.current === data.conversationId) setSelectedId(null);
        } else {
          void fetchConvos();
        }
      } catch {
        void fetchConvos();
      }
    }) as EventListener);

    es.addEventListener("typing", ((ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { conversationId: string; userId: string; displayName: string; typing: boolean };
        if (!data?.conversationId || data.userId === selfId) return;
        const key = `${data.conversationId}:${data.userId}`;
        if (typingTimers.current[key]) clearTimeout(typingTimers.current[key]);
        if (data.typing) {
          setTyping((prev) => {
            const list = prev[data.conversationId] ?? [];
            if (list.some((t) => t.userId === data.userId)) return prev;
            return { ...prev, [data.conversationId]: [...list, { userId: data.userId, displayName: data.displayName }] };
          });
          // Auto-expire so a dropped "stopped" event can never stick.
          typingTimers.current[key] = setTimeout(() => {
            setTyping((prev) => ({
              ...prev,
              [data.conversationId]: (prev[data.conversationId] ?? []).filter((t) => t.userId !== data.userId),
            }));
          }, 4000);
        } else {
          setTyping((prev) => ({
            ...prev,
            [data.conversationId]: (prev[data.conversationId] ?? []).filter((t) => t.userId !== data.userId),
          }));
        }
      } catch {
        // ignore malformed typing events
      }
    }) as EventListener);

    return () => {
      es.close();
      Object.values(typingTimers.current).forEach(clearTimeout);
    };
  }, [fetchConvos, loadThread, markRead, selfId]);

  /* ── Autoscroll ── */

  useEffect(() => {
    if (listRef.current && autoScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [threads, selectedId, autoScroll]);

  const sendTyping = useCallback(
    (conversationId: string, typingOn: boolean) => {
      if (!typingOn) {
        void fetch(`/api/chat/typing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, typing: false }),
        }).catch(() => {});
        return;
      }
      const now = Date.now();
      if (now - (lastTypingSent.current[conversationId] ?? 0) < 2500) return;
      lastTypingSent.current[conversationId] = now;
      void fetch(`/api/chat/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, typing: true }),
      }).catch(() => {});
    },
    []
  );

  /* ── Send ── */

  const sendMessage = async (payload: { text: string; json: unknown } | null) => {
    const conversationId = selectedIdRef.current;
    if (!conversationId) return;
    const text = payload?.text?.trim() ?? draft?.text?.trim() ?? "";
    const json = payload?.json ?? draft?.json ?? null;
    if (!text || sending) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, contentJson: json ? JSON.stringify(json) : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to send.");
      const msg: ChatMessage = data.message;
      // Append from the POST response; the SSE echo of our own message is
      // deduped by id when it arrives.
      setThreads((prev) => {
        const thread = prev[conversationId] ?? { messages: [], hasMore: false, loading: false };
        if (thread.messages.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [conversationId]: { ...thread, messages: [...thread.messages, msg] } };
      });
      setConvos((prev) =>
        sortByActivity(
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  updatedAt: msg.createdAt,
                  lastMessage: { id: msg.id, content: msg.content, createdAt: msg.createdAt, userId: msg.userId, userEmail: msg.userEmail, displayName: msg.displayName },
                }
              : c
          )
        )
      );
      setDraft(null);
      setEditorKey((k) => k + 1);
      sendTyping(conversationId, false);
      setAutoScroll(true);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const handleMentionClick = (type: string, id: string) => {
    if (type === "person") router.push("/admin");
    else if (type === "project") router.push("/projects");
    else if (type === "file" || type === "folder") router.push(`/files?highlight=${encodeURIComponent(id)}`);
    else if (type === "checkpoint") router.push(`/checkpoints#${encodeURIComponent(id)}`);
  };

  /* ── Derived ── */

  const selected = convos.find((c) => c.id === selectedId) ?? null;
  const thread = selectedId ? (threads[selectedId] ?? { messages: [], hasMore: false, loading: true }) : null;
  const typingHere = selectedId ? (typing[selectedId] ?? []) : [];
  const totalUnread = convos.reduce((n, c) => n + c.unreadCount, 0);

  const filteredConvos = listQuery.trim()
    ? convos.filter((c) => {
        const q = listQuery.trim().toLowerCase();
        if (convoTitle(c, selfId).toLowerCase().includes(q)) return true;
        if (c.lastMessage?.content.toLowerCase().includes(q)) return true;
        return c.members.some((m) => m.email.toLowerCase().includes(q) || (m.displayName ?? "").toLowerCase().includes(q));
      })
    : convos;

  /* ── Render ── */

  return (
    <div className="flex h-[calc(100dvh-118px)] min-h-[520px] w-full bg-canvas">
      {/* ── Left pane: conversation list ── */}
      <aside className={`w-full flex-col border-r border-hairline-soft bg-canvas md:w-[340px] md:shrink-0 lg:w-[380px] ${selectedId ? "hidden md:flex" : "flex"}`}>
        <div className="flex items-center gap-2 border-b border-hairline-soft px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-ink">Chats</h2>
              {totalUnread > 0 && (
                <span className="rounded-full bg-violet px-2 py-0.5 font-mono text-[11px] font-bold text-white">{totalUnread}</span>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-steel">
              <span className={`h-1.5 w-1.5 rounded-full ${streamState === "live" ? "bg-success-text" : "bg-amber-500 animate-pulse"}`} />
              {streamState === "live" ? "Live" : "Connecting…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            title="New chat"
            aria-label="New chat"
            className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white hover:bg-charcoal"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>

        <div className="border-b border-hairline-soft px-4 py-2.5">
          <input
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Search chats"
            className="h-10 w-full rounded-lg border border-hairline bg-fog px-3 text-sm outline-none placeholder:text-stone focus:border-ink"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="space-y-1 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl px-3 py-3">
                  <div className="h-11 w-11 shrink-0 rounded-full bg-fog" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-fog" />
                    <div className="h-3 w-1/2 rounded bg-fog" />
                  </div>
                </div>
              ))}
            </div>
          ) : listError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-error">{listError}</p>
              <button onClick={() => { setLoadingList(true); void fetchConvos(); }} className="mt-3 rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold hover:border-ink">
                Retry
              </button>
            </div>
          ) : filteredConvos.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-display text-base font-semibold text-ink">{convos.length === 0 ? "No chats yet" : "No matches"}</p>
              <p className="mt-1 text-sm text-steel">{convos.length === 0 ? "Start a direct message or create a group." : "Try a different search."}</p>
              {convos.length === 0 && (
                <button onClick={() => setNewChatOpen(true)} className="mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-charcoal">
                  New chat
                </button>
              )}
            </div>
          ) : (
            <ul className="p-2">
              {filteredConvos.map((c) => {
                const isActive = c.id === selectedId;
                const title = convoTitle(c, selfId);
                const o = c.type === "direct" ? otherMember(c, selfId) : undefined;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${isActive ? "bg-fog" : "hover:bg-fog/70"}`}
                    >
                      {c.type === "group" ? (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet/15 text-violet" aria-hidden>
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </span>
                      ) : (
                        <UserAvatar displayName={o?.displayName} email={o?.email} userId={o?.userId} avatarDriveId={o?.avatarDriveId} size={44} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{title}</span>
                          <span className={`shrink-0 font-mono text-[11px] ${c.unreadCount > 0 ? "font-bold text-violet" : "text-stone"}`}>
                            {listTime(c.lastMessage?.createdAt ?? c.updatedAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] text-steel">
                            {c.type === "group" && c.lastMessage ? `${getDisplayName(c.lastMessage.displayName, c.lastMessage.userEmail)}: ` : ""}
                            {c.lastMessage ? previewText(c.lastMessage.content) : c.type === "group" ? `${c.members.length} members` : "Say hi 👋"}
                          </span>
                          {c.unreadCount > 0 && (
                            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet px-1.5 font-mono text-[11px] font-bold text-white">
                              {c.unreadCount > 99 ? "99+" : c.unreadCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Right pane: thread ── */}
      <section className={`min-w-0 flex-1 flex-col bg-canvas ${selectedId ? "flex" : "hidden md:flex"}`}>
        {!selected ? (
          <div className="hidden flex-1 flex-col items-center justify-center px-8 text-center md:flex">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-violet/10 text-violet" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <h3 className="mt-4 font-display text-xl font-bold text-ink">Your messages</h3>
            <p className="mt-1 max-w-sm text-sm text-steel">Private 1:1 chats and group conversations live here. Pick a chat, or start a new one.</p>
            <button onClick={() => setNewChatOpen(true)} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-charcoal">
              New chat
            </button>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 border-b border-hairline-soft px-4 py-2.5">
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Back to chats" className="press grid h-9 w-9 place-items-center rounded-full border border-hairline md:hidden">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
              </button>
              {selected.type === "group" ? (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet/15 text-violet" aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
              ) : (
                (() => {
                  const o = otherMember(selected, selfId);
                  return <UserAvatar displayName={o?.displayName} email={o?.email} userId={o?.userId} avatarDriveId={o?.avatarDriveId} size={40} />;
                })()
              )}
              <button
                type="button"
                onClick={() => selected.type === "group" && setGroupInfoOpen((v) => !v)}
                className={`min-w-0 flex-1 text-left ${selected.type === "group" ? "cursor-pointer" : "cursor-default"}`}
                title={selected.type === "group" ? "Group info" : undefined}
              >
                <span className="block truncate text-[15px] font-semibold text-ink">{convoTitle(selected, selfId)}</span>
                <span className="block truncate font-mono text-[11px] text-steel">
                  {typingHere.length > 0
                    ? `${typingHere.map((t) => getDisplayName(t.displayName, null)).join(", ")} typing…`
                    : selected.type === "group"
                      ? `${selected.members.length} members — tap for info`
                      : (otherMember(selected, selfId)?.email ?? "")}
                </span>
              </button>
              {selected.type === "group" && (
                <button type="button" onClick={() => setGroupInfoOpen((v) => !v)} aria-label="Group info" className="press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-hairline hover:border-ink">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                </button>
              )}
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Messages + composer */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  ref={listRef}
                  onScroll={() => {
                    if (!listRef.current) return;
                    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
                    setAutoScroll(scrollHeight - scrollTop - clientHeight < 80);
                  }}
                  className="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
                >
                  {thread?.loading && thread.messages.length === 0 ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-12 w-2/3 rounded-xl bg-fog" />
                      <div className="ml-auto h-12 w-1/2 rounded-xl bg-fog" />
                      <div className="h-12 w-3/5 rounded-xl bg-fog" />
                    </div>
                  ) : (thread?.messages.length ?? 0) === 0 ? (
                    <div className="py-12 text-center">
                      <p className="font-display text-lg font-medium text-charcoal">No messages yet</p>
                      <p className="mt-1 text-sm text-steel">Say hi — it delivers instantly.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {thread?.hasMore && (
                        <div className="text-center">
                          <button
                            onClick={() => selectedId && thread.messages[0] && void loadThread(selectedId, thread.messages[0].createdAt)}
                            className="rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold text-steel hover:border-ink hover:text-ink"
                          >
                            Load earlier messages
                          </button>
                        </div>
                      )}
                      {thread?.messages.map((m) => {
                        const isOwn = m.userId === selfId;
                        return (
                          <div key={m.id} className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
                            <UserAvatar displayName={m.displayName} email={m.userEmail} userId={m.userId} avatarDriveId={m.avatarDriveId} size={32} />
                            <div className={`flex max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
                              <div className={`flex items-center gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                                <span className="text-sm font-semibold text-ink">{getDisplayName(m.displayName, m.userEmail)}</span>
                                <span className="font-mono text-[11px] text-stone">{formatDateTime(m.createdAt)}</span>
                              </div>
                              <div className={`mt-1 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isOwn ? "bg-ink text-white" : "border border-hairline bg-fog text-ink"}`}>
                                {m.contentJson ? (
                                  (() => {
                                    try {
                                      return renderTiptapJsonToReact(JSON.parse(m.contentJson), handleMentionClick) || m.content;
                                    } catch {
                                      return m.content;
                                    }
                                  })()
                                ) : (
                                  m.content
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {threadError && <p className="mt-3 text-xs text-error">{threadError}</p>}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendMessage(null);
                  }}
                  className="border-t border-hairline-soft bg-canvas p-3"
                >
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <TiptapEditor
                        key={`${selectedId}-${editorKey}`}
                        placeholder={`Message ${selected.type === "group" ? (selected.name || "group") : convoTitle(selected, selfId)}… @ to mention (Enter to send)`}
                        onChange={(c) => {
                          setDraft(c);
                          if (c.text.trim() && selectedId) sendTyping(selectedId, true);
                        }}
                        onSubmit={(content) => {
                          void sendMessage(content);
                        }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={sending || !draft?.text?.trim()}
                      className="h-11 shrink-0 rounded-full bg-ink px-6 text-sm font-semibold text-white hover:bg-charcoal disabled:opacity-50"
                    >
                      {sending ? "…" : "Send"}
                    </button>
                  </div>
                </form>
              </div>

              {/* Group info panel */}
              {groupInfoOpen && selected.type === "group" && (
                <GroupInfoPanel
                  convo={selected}
                  selfId={selfId}
                  onChanged={() => {
                    void fetchConvos();
                    if (selectedId) void loadThread(selectedId);
                  }}
                  onLeft={() => {
                    setGroupInfoOpen(false);
                    setSelectedId(null);
                    void fetchConvos();
                  }}
                  onClose={() => setGroupInfoOpen(false)}
                />
              )}
            </div>
          </>
        )}
      </section>

      {newChatOpen && (
        <NewChatModal
          onClose={() => setNewChatOpen(false)}
          onCreated={(id) => {
            setNewChatOpen(false);
            void fetchConvos().then(() => selectConversation(id));
          }}
        />
      )}
    </div>
  );
}

/* ── Group info panel ───────────────────────────────────────────────── */

function GroupInfoPanel({
  convo,
  selfId,
  onChanged,
  onLeft,
  onClose,
}: {
  convo: Convo;
  selfId: string;
  onChanged: () => void;
  onLeft: () => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/users?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Search failed.");
        const memberIds = new Set(convo.members.map((m) => m.userId));
        setResults(((data?.users ?? []) as DirectoryUser[]).filter((u) => !memberIds.has(u.id)));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [adding, query, convo.members]);

  const addMember = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${convo.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not add.");
      setQuery("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${convo.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not remove.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!confirm(`Leave "${convo.name || "this group"}"?`)) return;
    setBusy("leave");
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${convo.id}/leave`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not leave.");
      onLeft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-l border-hairline-soft bg-canvas lg:flex">
      <div className="flex items-center justify-between border-b border-hairline-soft px-4 py-3">
        <h3 className="font-display text-sm font-bold text-ink">Group info</h3>
        <button onClick={onClose} aria-label="Close group info" className="grid h-8 w-8 place-items-center rounded-full border border-hairline text-sm hover:border-ink">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="font-display text-base font-bold text-ink">{convo.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-steel">{convo.members.length} members</p>

        {error && <p className="mt-3 text-xs text-error">{error}</p>}

        <ul className="mt-4 space-y-1">
          {convo.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
              <UserAvatar displayName={m.displayName} email={m.email} userId={m.userId} avatarDriveId={m.avatarDriveId} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {getDisplayName(m.displayName, m.email)}{m.userId === selfId ? " (you)" : ""}
                </span>
                <span className="block truncate font-mono text-[11px] text-steel">{m.email}</span>
              </span>
              {m.userId !== selfId && (
                <button
                  onClick={() => void removeMember(m.userId)}
                  disabled={busy !== null}
                  title={`Remove ${m.email}`}
                  className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold text-steel hover:border-error hover:text-error disabled:opacity-50"
                >
                  {busy === m.userId ? "…" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>

        {!adding ? (
          <button onClick={() => setAdding(true)} className="mt-4 w-full rounded-full border border-hairline px-4 py-2 text-xs font-semibold hover:border-ink">
            + Add members
          </button>
        ) : (
          <div className="mt-4 rounded-xl border border-hairline p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="h-9 w-full rounded-lg bg-fog px-3 text-sm outline-none placeholder:text-stone"
            />
            <ul className="mt-1 max-h-44 overflow-y-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button onClick={() => void addMember(u.id)} disabled={busy !== null} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-fog disabled:opacity-50">
                    <UserAvatar displayName={u.displayName} email={u.email} userId={u.id} avatarDriveId={u.avatarDriveId} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{getDisplayName(u.displayName, u.email)}</span>
                      <span className="block truncate font-mono text-[11px] text-steel">{u.email}</span>
                    </span>
                    <span className="text-xs font-bold text-violet">{busy === u.id ? "…" : "+"}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-2 py-2 text-xs text-stone">No one found.</li>}
            </ul>
            <button onClick={() => { setAdding(false); setQuery(""); }} className="mt-1 w-full py-1 text-center text-xs font-semibold text-steel hover:text-ink">
              Done
            </button>
          </div>
        )}

        <button
          onClick={() => void leave()}
          disabled={busy !== null}
          className="mt-4 w-full rounded-full border border-error/40 px-4 py-2 text-xs font-semibold text-error hover:bg-error-bg disabled:opacity-50"
        >
          {busy === "leave" ? "Leaving…" : "Leave group"}
        </button>
      </div>
    </aside>
  );
}

/* ── New chat modal ─────────────────────────────────────────────────── */

function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [picked, setPicked] = useState<DirectoryUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/users?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Search failed.");
        const pickedIds = new Set(picked.map((p) => p.id));
        setResults(((data?.users ?? []) as DirectoryUser[]).filter((u) => !pickedIds.has(u.id)));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, picked]);

  const create = async (userIds: string[], type: "direct" | "group", name?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, participantIds: userIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not create chat.");
      onCreated(data.conversation.id as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create chat.");
    } finally {
      setBusy(false);
    }
  };

  const togglePick = (u: DirectoryUser) => {
    setPicked((prev) => (prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-label="New chat">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-canvas shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline-soft px-5 py-4">
          <h3 className="font-display text-base font-bold text-ink">New chat</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full border border-hairline hover:border-ink">✕</button>
        </div>

        <div className="flex gap-2 px-5 pt-4">
          {(["dm", "group"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${mode === m ? "bg-ink text-white" : "bg-fog text-steel hover:text-ink"}`}
            >
              {m === "dm" ? "Direct message" : "New group"}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {mode === "group" && (
            <>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                maxLength={80}
                className="mb-3 h-11 w-full rounded-xl border border-hairline bg-canvas px-4 text-sm outline-none placeholder:text-stone focus:border-ink"
              />
              {picked.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <button key={p.id} onClick={() => togglePick(p)} title="Remove" className="flex items-center gap-1.5 rounded-full bg-violet/10 py-1 pl-1 pr-2.5 text-xs font-semibold text-violet">
                      <UserAvatar displayName={p.displayName} email={p.email} userId={p.id} avatarDriveId={p.avatarDriveId} size={20} />
                      {getDisplayName(p.displayName, p.email)} ✕
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or email"
            className="h-11 w-full rounded-xl border border-hairline bg-fog px-4 text-sm outline-none placeholder:text-stone focus:border-ink"
          />

          <ul className="mt-2 max-h-60 overflow-y-auto">
            {results.map((u) => {
              const isPicked = picked.some((p) => p.id === u.id);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => (mode === "dm" ? void create([u.id], "direct") : togglePick(u))}
                    disabled={busy}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-fog disabled:opacity-50 ${isPicked ? "bg-violet/5" : ""}`}
                  >
                    <UserAvatar displayName={u.displayName} email={u.email} userId={u.id} avatarDriveId={u.avatarDriveId} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{getDisplayName(u.displayName, u.email)}</span>
                      <span className="block truncate font-mono text-[11px] text-steel">{u.email}</span>
                    </span>
                    {mode === "group" && (
                      <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs font-bold ${isPicked ? "border-violet bg-violet text-white" : "border-hairline text-stone"}`}>
                        {isPicked ? "✓" : ""}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {results.length === 0 && (
              <li className="px-2 py-4 text-center">
                {query.trim() ? (
                  <>
                    <p className="text-xs font-medium text-ink">No matches for “{query.trim()}”</p>
                    <p className="mt-1 text-xs text-steel">Try a different name or email.</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-ink">No other team members yet</p>
                    <p className="mt-1 text-xs text-steel">Invite your team from Admin → Create account to start chatting.</p>
                    <a href="/admin" className="mt-2 inline-flex rounded-full border border-hairline px-3 py-1 text-xs font-semibold hover:border-ink">Go to Admin</a>
                  </>
                )}
              </li>
            )}
          </ul>

          {error && <p className="mt-2 text-xs text-error">{error}</p>}

          {mode === "group" && (
            <button
              onClick={() => picked.length > 0 && groupName.trim() && void create(picked.map((p) => p.id), "group", groupName.trim())}
              disabled={busy || picked.length === 0 || !groupName.trim()}
              className="mt-3 w-full rounded-full bg-ink py-2.5 text-sm font-semibold text-white hover:bg-charcoal disabled:opacity-50"
            >
              {busy ? "Creating…" : `Create group${picked.length > 0 ? ` (${picked.length})` : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
