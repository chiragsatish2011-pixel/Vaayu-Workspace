"use client";

import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { mentionChipColor, mentionIcon, type MentionType } from "@/lib/mentions";

export interface SuggestionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel: string;
  email?: string;
  avatarDriveId?: string | null;
  displayName?: string | null;
}

const typeOrder: MentionType[] = ["person", "project", "folder", "file", "checkpoint"];
const typeLabels: Record<MentionType, string> = {
  person: "People",
  project: "Projects",
  folder: "Folders",
  file: "Files",
  checkpoint: "Checkpoints",
};

export function MentionList({
  items,
  command,
}: {
  items: SuggestionItem[];
  command: (item: { id: string; label: string; type: MentionType; email?: string; avatarDriveId?: string | null }) => void;
}) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[selected];
        if (it) command({ id: it.id, label: it.label, type: it.type, email: it.email, avatarDriveId: it.avatarDriveId });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, command]);

  if (items.length === 0) {
    return (
      <div className="w-[min(320px,calc(100vw-32px))] rounded-xl border border-white/10 bg-[#1e1e1e] p-3 text-xs text-zinc-400 shadow-[0_12px_32px_rgba(0,0,0,0.4)]">No results. Try a different query.</div>
    );
  }

  // Group by type — but if the list is just the two channel shortcuts (@explore/@general), render flat without headers to match screenshot
  const isChannelPopup = items.length <= 2 && items.every((i) => i.label === "explore" || i.label === "general");
  if (isChannelPopup) {
    return (
      <div className="w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
        {items.map((item, idx) => {
          const isSelected = idx === selected;
          const isExplore = item.label === "explore";
          return (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => command({ id: item.id, label: item.label, type: item.type, email: item.email, avatarDriveId: item.avatarDriveId })}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${isSelected ? "bg-white/10" : "hover:bg-white/[0.06]"}`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-white/20 bg-white/5 text-amber-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2" opacity="0.9" />
                  <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
                  <path d="M12 3.5v2 M12 18.5v2 M3.5 12h2 M18.5 12h2" strokeLinecap="round" opacity="0.6" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">@{item.label}</span>
                <span className="block truncate text-xs text-zinc-400">{isExplore ? "Browse everything" : "Notify everyone"}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Group by type
  const grouped = typeOrder
    .map((t) => ({ type: t, items: items.filter((i) => i.type === t) }))
    .filter((g) => g.items.length > 0);

  let globalIndex = -1;

  return (
    <div className="max-h-80 w-[min(320px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-white/10 bg-[#1e1e1e] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
      {grouped.map((group) => (
        <div key={group.type} className="mb-2 last:mb-0">
          <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            <span>{mentionIcon(group.type)}</span> {typeLabels[group.type]}
          </div>
          {group.items.map((item) => {
            globalIndex += 1;
            const isSelected = globalIndex === selected;
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => command({ id: item.id, label: item.label, type: item.type, email: item.email, avatarDriveId: item.avatarDriveId })}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-white/10 text-white" : "hover:bg-white/[0.06] text-zinc-200"}`}
              >
                {item.type === "person" ? (
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${isSelected ? "ring-1 ring-white/20" : ""}`}>
                    <UserAvatar displayName={item.displayName ?? item.label} email={item.email ?? item.sublabel} avatarDriveId={item.avatarDriveId} size={24} />
                  </span>
                ) : (
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs border ${isSelected ? "bg-white/15 text-white border-white/10" : "bg-white/5 text-zinc-400 border-white/10"}`}>
                    {mentionIcon(item.type)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-none text-white">{item.label}</span>
                  <span className={`block truncate font-mono text-[11px] ${isSelected ? "text-zinc-300" : "text-zinc-500"}`}>{item.sublabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
