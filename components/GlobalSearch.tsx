"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";

interface MentionHit {
  type: "person" | "project" | "file" | "folder" | "checkpoint";
  id: string;
  label: string;
  sublabel: string;
  email?: string;
  avatarDriveId?: string | null;
  displayName?: string | null;
}

interface ConvoHit {
  id: string;
  type: "direct" | "group";
  name: string | null;
  members: Array<{ userId: string; email: string; displayName: string | null }>;
  lastMessage: { content: string } | null;
}

function convoTitle(c: ConvoHit, selfEmail?: string): string {
  if (c.type === "group") return c.name || "Unnamed group";
  const others = c.members.filter((m) => m.email !== selfEmail);
  const o = others[0] ?? c.members[0];
  if (!o) return "Direct message";
  return getDisplayName(o.displayName, o.email);
}

function targetForHit(hit: MentionHit): string {
  if (hit.type === "person") return "/admin";
  if (hit.type === "project") return "/projects";
  if (hit.type === "file" || hit.type === "folder") return `/files?highlight=${encodeURIComponent(hit.id)}`;
  return `/checkpoints#${encodeURIComponent(hit.id)}`;
}

const GROUP_LABELS: Record<MentionHit["type"], string> = {
  person: "People",
  project: "Projects",
  folder: "Folders",
  file: "Files",
  checkpoint: "Checkpoints",
};

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mentions, setMentions] = useState<MentionHit[]>([]);
  const [convos, setConvos] = useState<ConvoHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere (unless already typing)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Lazy-load conversation list once (filtered client-side per keystroke)
  useEffect(() => {
    if (!open || convos !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/conversations", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(data?.conversations)) setConvos(data.conversations);
      } catch {
        if (!cancelled) setConvos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, convos]);

  // Debounced mentions search
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      setMentions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        setMentions(res.ok && Array.isArray(data?.results) ? data.results : []);
      } catch {
        setMentions([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const matchedConvos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !convos) return [];
    return convos
      .filter((c) => {
        if (convoTitle(c).toLowerCase().includes(q)) return true;
        if (c.lastMessage?.content.toLowerCase().includes(q)) return true;
        return c.members.some((m) => m.email.toLowerCase().includes(q) || (m.displayName ?? "").toLowerCase().includes(q));
      })
      .slice(0, 4);
  }, [query, convos]);

  const mentionGroups = useMemo(() => {
    const order: MentionHit["type"][] = ["person", "project", "folder", "file", "checkpoint"];
    return order
      .map((t) => ({ type: t, items: mentions.filter((m) => m.type === t).slice(0, 3) }))
      .filter((g) => g.items.length > 0);
  }, [mentions]);

  const hasQuery = query.trim().length > 0;
  const empty = hasQuery && !loading && matchedConvos.length === 0 && mentionGroups.length === 0;

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  };

  return (
    <div className="relative hidden min-w-0 flex-1 max-w-xs sm:block">
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-hairline bg-fog px-3 text-steel focus-within:border-ink">
        <SearchIcon className="h-4 w-4 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search chats, people, files…"
          className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-stone"
          role="combobox"
          aria-expanded={open}
          aria-label="Global search"
        />
        <kbd className="hidden shrink-0 rounded border border-hairline bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-stone md:block">/</kbd>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 cursor-default" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-2xl">
            {!hasQuery ? (
              <p className="px-4 py-3 text-xs text-stone">Type to search chats, people, projects and files.</p>
            ) : loading && matchedConvos.length === 0 && mentionGroups.length === 0 ? (
              <p className="px-4 py-3 text-xs text-stone">Searching…</p>
            ) : empty ? (
              <p className="px-4 py-3 text-xs text-stone">No matches for “{query.trim()}”.</p>
            ) : (
              <div className="max-h-[320px] overflow-y-auto p-1.5">
                {matchedConvos.length > 0 && (
                  <div className="mb-1">
                    <p className="px-2.5 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-stone">Chats</p>
                    {matchedConvos.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(`/chat?c=${encodeURIComponent(c.id)}`)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-fog"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet/15 text-xs text-violet">💬</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{convoTitle(c)}</span>
                          {c.lastMessage && <span className="block truncate text-[11px] text-steel">{c.lastMessage.content}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {mentionGroups.map((g) => (
                  <div key={g.type} className="mb-1 last:mb-0">
                    <p className="px-2.5 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-stone">{GROUP_LABELS[g.type]}</p>
                    {g.items.map((m) => (
                      <button
                        key={`${m.type}-${m.id}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(targetForHit(m))}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-fog"
                      >
                        {m.type === "person" ? (
                          <UserAvatar displayName={m.displayName ?? m.label} email={m.email ?? m.sublabel} avatarDriveId={m.avatarDriveId} size={28} />
                        ) : (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fog text-xs text-steel">@</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{m.label}</span>
                          <span className="block truncate font-mono text-[11px] text-steel">{m.sublabel}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
