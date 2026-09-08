"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { formatDateTime } from "@/lib/format";
import { TiptapEditor, extractPlainTextFromTiptap, renderTiptapJsonToReact } from "@/components/mentions/TiptapEditor";

export interface ChatMessage {
  id: string;
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

interface ChatManagerProps {
  currentUser: { id: string; email: string; displayName?: string | null };
}

export function ChatManager({ currentUser }: ChatManagerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const router = useRouter();

  const scrollToBottom = () => {
    if (listRef.current && autoScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/chat/messages", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load messages.");
      const msgs: ChatMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(msgs);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages(false);
    const id = setInterval(() => fetchMessages(true), 2500);
    return () => clearInterval(id);
  }, []);

  const sendWithContent = async (payload: { text: string; json: unknown } | null) => {
    const text = payload?.text?.trim() ?? draft?.text?.trim() ?? "";
    const json = payload?.json ?? draft?.json ?? null;
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, contentJson: json ? JSON.stringify(json) : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to send.");
      const msg: ChatMessage = data.message;
      setMessages((prev) => [...prev, msg]);
      setDraft(null);
      setEditorKey((k) => k + 1);
      setTimeout(scrollToBottom, 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await sendWithContent(null);
  };

  const [editorKey, setEditorKey] = useState(0);

  const handleMentionClick = (type: string, id: string) => {
    if (type === "person") {
      router.push("/admin"); // for now, people -> team page; could open profile modal
    } else if (type === "project") {
      router.push("/projects");
    } else if (type === "file" || type === "folder") {
      router.push(`/files?highlight=${encodeURIComponent(id)}`);
    } else if (type === "checkpoint") {
      router.push(`/checkpoints#${encodeURIComponent(id)}`);
    }
  };

  return (
    <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline-soft bg-fog/50 px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-bold text-ink">Team Chat</h2>
          <p className="font-mono text-[11px] text-steel">{messages.length} messages · live polling 2.5s</p>
        </div>
        <button
          onClick={() => fetchMessages(false)}
          className="rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold text-ink hover:border-ink"
        >
          Refresh
        </button>
      </div>

      {/* List */}
      <div
        ref={listRef}
        onScroll={() => {
          if (!listRef.current) return;
          const { scrollTop, scrollHeight, clientHeight } = listRef.current;
          const nearBottom = scrollHeight - scrollTop - clientHeight < 80;
          setAutoScroll(nearBottom);
        }}
        className="flex-1 overflow-y-auto bg-canvas p-4"
      >
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-12 rounded-xl bg-fog" />
            <div className="h-12 rounded-xl bg-fog" />
            <div className="h-12 rounded-xl bg-fog" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-display text-lg font-medium text-charcoal">No messages yet</p>
            <p className="mt-1 text-sm text-steel">Say hi to the team — your message will appear here instantly.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => {
              const isOwn = m.userId === currentUser.id;
              const primary = getDisplayName(m.displayName, m.userEmail);
              return (
                <div key={m.id} className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
                  <UserAvatar displayName={m.displayName} email={m.userEmail} userId={m.userId} avatarDriveId={m.avatarDriveId} size={32} />
                  <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
                    <div className={`flex items-center gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                      <span className="text-sm font-semibold text-ink">{primary}</span>
                      <span className="font-mono text-[11px] text-stone">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <div
                      className={`mt-1 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        isOwn ? "bg-ink text-white" : "bg-fog border border-hairline text-ink"
                      }`}
                    >
                      {m.contentJson ? (
                        (() => {
                          try {
                            const json = JSON.parse(m.contentJson);
                            return renderTiptapJsonToReact(json, handleMentionClick) || m.content;
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
        {error && <p className="mt-3 text-xs text-error">{error}</p>}
      </div>

      {/* Composer — Tiptap with @ mentions */}
      <form onSubmit={handleSend} className="border-t border-hairline-soft bg-fog/50 p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TiptapEditor
              key={editorKey}
              placeholder="Message the team… @ to mention people, projects, files, checkpoints (Enter to send, Shift+Enter new line)"
              onChange={setDraft}
              onSubmit={(content) => {
                void sendWithContent(content);
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
        <p className="mt-1.5 font-mono text-[11px] text-stone">Chat history is stored in Neon Postgres — mentions are structured, clickable, and survive reloads.</p>
      </form>
    </div>
  );
}
