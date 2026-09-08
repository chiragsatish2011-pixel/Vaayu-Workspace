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
      <div className="rounded-xl border border-hairline bg-canvas p-3 text-xs text-steel shadow-xl">No results. Try a different query.</div>
    );
  }

  // Group by type
  const grouped = typeOrder
    .map((t) => ({ type: t, items: items.filter((i) => i.type === t) }))
    .filter((g) => g.items.length > 0);

  let globalIndex = -1;

  return (
    <div className="max-h-80 w-80 overflow-y-auto rounded-xl border border-hairline bg-canvas p-2 shadow-xl">
      {grouped.map((group) => (
        <div key={group.type} className="mb-2 last:mb-0">
          <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-stone">
            <span>{mentionIcon(group.type)}</span> {typeLabels[group.type]}
          </div>
          {group.items.map((item) => {
            globalIndex += 1;
            const isSelected = globalIndex === selected;
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => command({ id: item.id, label: item.label, type: item.type, email: item.email, avatarDriveId: item.avatarDriveId })}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isSelected ? "bg-ink text-white" : "hover:bg-fog text-ink"
                }`}
              >
                {item.type === "person" ? (
                  <UserAvatar displayName={item.displayName ?? item.label} email={item.email ?? item.sublabel} avatarDriveId={item.avatarDriveId} size={24} />
                ) : (
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${isSelected ? "bg-white/20 text-white" : mentionChipColor(item.type) + " border"}`}>
                    {mentionIcon(item.type)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-none">{item.label}</span>
                  <span className={`block truncate font-mono text-[11px] ${isSelected ? "text-white/70" : "text-steel"}`}>{item.sublabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
