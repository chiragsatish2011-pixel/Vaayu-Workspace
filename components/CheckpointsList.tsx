"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Badge";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { formatDateTime } from "@/lib/format";
import { extractPlainTextFromTiptap, renderTiptapJsonToReact, TiptapEditor } from "@/components/mentions/TiptapEditor";

export interface CheckpointItem {
  id: string;
  note: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName?: string | null;
  avatarDriveId?: string | null;
  contentJson?: string | null;
}

export interface CheckpointViewer {
  id: string;
  role: "admin" | "member";
}

const EXAMPLE_NOTES = [
  "made landingpage of vaayu smoother",
  "updates design theme in mobile app",
  "fixed loading state bug",
  "added checkpoints section for team progress",
];

const formatDate = formatDateTime;

export function CheckpointsList({
  initialItems,
  currentUser,
  notice,
}: {
  initialItems: CheckpointItem[];
  currentUser: CheckpointViewer;
  notice?: string | null;
}) {
  const [items, setItems] = useState<CheckpointItem[]>(initialItems);
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);
  const [createDraft, setCreateDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const [createInitial, setCreateInitial] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [editKey, setEditKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  function canModerate(item: CheckpointItem): boolean {
    return item.userId === currentUser.id || currentUser.role === "admin";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = createDraft;
    const trimmed = payload?.text?.trim() ?? "";
    if (!trimmed) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed, contentJson: payload?.json ? JSON.stringify(payload.json) : null }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create checkpoint.");
      }

      setItems((prev) => [data.checkpoint, ...prev]);
      setCreateDraft(null);
      setCreateInitial(null);
      setCreateKey((k) => k + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditing(item: CheckpointItem) {
    setEditingId(item.id);
    if (item.contentJson) {
      try {
        const parsed = JSON.parse(item.contentJson);
        const text = extractPlainTextFromTiptap(parsed) || item.note;
        setEditDraft({ text, json: parsed });
      } catch {
        setEditDraft({ text: item.note, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: item.note }] }] } });
      }
    } else {
      setEditDraft({ text: item.note, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: item.note }] }] } });
    }
    setEditKey((k) => k + 1);
    setError(null);
  }

  async function handleUpdate(item: CheckpointItem) {
    const payload = editDraft;
    const trimmed = payload?.text?.trim() ?? "";
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/checkpoints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, note: trimmed, contentJson: payload?.json ? JSON.stringify(payload.json) : null }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update checkpoint.");
      }

      setItems((prev) =>
        prev.map((entry) => (entry.id === item.id ? data.checkpoint : entry))
      );
      setEditingId(null);
      setEditDraft(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: CheckpointItem) {
    if (deletingId) return;
    const confirmed = window.confirm(
      "Delete this checkpoint? It will be removed from the team timeline (kept as deleted history in the sheet)."
    );
    if (!confirmed) return;

    setDeletingId(item.id);
    setError(null);

    try {
      const res = await fetch("/api/checkpoints", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && data.error) || "Failed to delete checkpoint."
        );
      }

      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) {
        setEditingId(null);
        setEditDraft(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDeletingId(null);
    }
  }

  const handleMentionClick = (type: string, id: string) => {
    if (type === "person") router.push("/admin");
    else if (type === "project") router.push("/projects");
    else if (type === "file" || type === "folder") router.push(`/files?highlight=${encodeURIComponent(id)}`);
    else if (type === "checkpoint") {
      const el = document.getElementById(`checkpoint-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      else router.push(`/checkpoints#${encodeURIComponent(id)}`);
    }
  };

  const renderNote = (item: CheckpointItem) => {
    if (item.contentJson) {
      try {
        const json = JSON.parse(item.contentJson);
        const rendered = renderTiptapJsonToReact(json, handleMentionClick);
        if (rendered) return <div className="mt-2.5 text-sm leading-relaxed text-charcoal">{rendered}</div>;
      } catch {}
    }
    return <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-charcoal">{item.note}</p>;
  };

  return (
    <div className="space-y-8">
      {notice && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"
        >
          {notice}
        </p>
      )}

      {/* ── Form Card ── */}
      <div className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">
          Add a Checkpoint
        </h2>
        <p className="mt-1 text-sm text-steel">
          Share a quick update or note on what you just completed or improved. Use @ to mention people, projects, files, or checkpoints.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <TiptapEditor
              key={createKey}
              placeholder="e.g. made landingpage of vaayu smoother… @ to mention"
              initialText={createInitial ?? undefined}
              onChange={setCreateDraft}
              onSubmit={(content) => {
                setCreateDraft(content);
                setTimeout(() => handleSubmit({ preventDefault: () => {} } as React.FormEvent), 0);
              }}
            />
          </div>

          {/* Preset Suggestions — preserved alongside Tiptap */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
              Quick Suggestions
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_NOTES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: example }] }] };
                    setCreateDraft({ text: example, json });
                    setCreateInitial(example);
                    setCreateKey((k) => k + 1);
                    setTimeout(() => setCreateInitial(null), 0);
                  }}
                  className="rounded-lg border border-hairline bg-fog px-2.5 py-1 text-xs text-charcoal transition-colors hover:border-ink hover:bg-canvas"
                >
                  &ldquo;{example}&rdquo;
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-danger-text">{error}</p>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !createDraft?.text?.trim()}
              className="press inline-flex h-10 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Posting..." : "Post Checkpoint"}
            </button>
          </div>
        </form>
      </div>

      {/* ── Timeline Section ── */}
      <div className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
        <div className="flex items-center justify-between border-b border-hairline-soft pb-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Timeline
          </h2>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-steel">
            {items.length} {items.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-display text-lg font-medium text-charcoal">
              No checkpoints recorded yet
            </p>
            <p className="mt-1 text-sm text-steel">
              Be the first to post a milestone or progress note for the team!
            </p>
          </div>
        ) : (
          <div className="relative mt-6 space-y-6 pl-4 sm:pl-6 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-[2px] before:bg-hairline-soft sm:before:left-[23px]">
            {items.map((item) => {
              const primary = getDisplayName(item.displayName, item.userEmail);
              const secondary = item.userEmail;
              const isEditing = editingId === item.id;
              const isDeleting = deletingId === item.id;
              const edited =
                item.updatedAt &&
                item.createdAt &&
                new Date(item.updatedAt).getTime() >
                  new Date(item.createdAt).getTime() + 1000;

              return (
                <div key={item.id} id={`checkpoint-${item.id}`} className="relative flex items-start gap-4">
                  {/* Timeline avatar — deterministic color from stable userId/email, display name */}
                  <span className="relative z-10 shrink-0 rounded-full shadow-sm ring-4 ring-canvas">
                    <UserAvatar displayName={item.displayName} email={item.userEmail} userId={item.userId} avatarDriveId={item.avatarDriveId} size={40} />
                  </span>

                  {/* Content card — min-w-0 prevents flex overflow truncation like “Chira” */}
                  <div className="min-w-0 flex-1 rounded-xl border border-hairline bg-fog/50 p-4 transition-colors hover:bg-fog">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft/60 pb-2">
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="break-words font-display text-[15px] font-bold tracking-tight text-ink">
                            {primary}
                          </span>
                          <Badge tone={item.userRole === "admin" ? "phase" : "live"}>{item.userRole}</Badge>
                        </div>
                        <span className="break-all font-mono text-xs text-steel">{secondary}</span>
                      </div>
                      <time className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                        {formatDate(item.createdAt)}
                        {edited && " · edited"}
                      </time>
                    </div>
                    {isEditing ? (
                      <div className="mt-2.5 space-y-3">
                        <TiptapEditor
                          key={editKey}
                          placeholder="Edit checkpoint… @ to mention"
                          initialContentJson={item.contentJson ?? null}
                          initialText={!item.contentJson ? item.note : undefined}
                          onChange={setEditDraft}
                          onSubmit={(content) => {
                            setEditDraft(content);
                            setTimeout(() => handleUpdate(item), 0);
                          }}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                            }}
                            disabled={isSaving}
                            className="press inline-flex h-9 items-center justify-center rounded-full border border-hairline px-4 text-sm font-medium text-charcoal transition-colors hover:border-ink disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdate(item)}
                            disabled={isSaving || !editDraft?.text?.trim()}
                            className="press inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      renderNote(item)
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-stone" />
                      {canModerate(item) && !isEditing && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEditing(item)}
                            disabled={isDeleting}
                            className="press rounded-full border border-hairline px-3.5 py-1.5 text-xs font-medium text-steel transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            disabled={isDeleting}
                            className="press rounded-full border border-hairline px-3.5 py-1.5 text-xs font-medium text-steel transition-colors hover:border-error hover:text-error disabled:opacity-50"
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
