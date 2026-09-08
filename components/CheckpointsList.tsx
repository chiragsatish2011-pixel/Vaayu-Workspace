"use client";

import { useState } from "react";
import { Badge } from "@/components/Badge";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";

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

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function canModerate(item: CheckpointItem): boolean {
    return item.userId === currentUser.id || currentUser.role === "admin";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create checkpoint.");
      }

      setItems((prev) => [data.checkpoint, ...prev]);
      setNote("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditing(item: CheckpointItem) {
    setEditingId(item.id);
    setDraft(item.note);
    setError(null);
  }

  async function handleUpdate(item: CheckpointItem) {
    const trimmed = draft.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/checkpoints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, note: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update checkpoint.");
      }

      setItems((prev) =>
        prev.map((entry) => (entry.id === item.id ? data.checkpoint : entry))
      );
      setEditingId(null);
      setDraft("");
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
        setDraft("");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDeletingId(null);
    }
  }

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
          Share a quick update or note on what you just completed or improved.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="checkpoint-note" className="sr-only">
              Checkpoint note
            </label>
            <textarea
              id="checkpoint-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. made landingpage of vaayu smoother..."
              className="w-full rounded-xl border border-hairline bg-fog p-3.5 text-sm outline-none transition-colors focus:border-ink focus:bg-canvas"
            />
          </div>

          {/* Preset Suggestions */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
              Quick Suggestions
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_NOTES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setNote(example)}
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
              disabled={isSubmitting || !note.trim()}
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
                <div key={item.id} className="relative flex items-start gap-4">
                  {/* Timeline avatar — deterministic color, display name */}
                  <span className="relative z-10 shrink-0 rounded-full shadow-sm ring-4 ring-canvas">
                    <UserAvatar displayName={primary} email={item.userEmail} avatarDriveId={item.avatarDriveId} size={40} />
                  </span>

                  {/* Content card */}
                  <div className="flex-1 rounded-xl border border-hairline bg-fog/50 p-4 transition-colors hover:bg-fog">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft/60 pb-2">
                      <div className="flex min-w-0 flex-col leading-tight">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-display text-[15px] font-bold tracking-tight text-ink">
                            {primary}
                          </span>
                          <Badge tone={item.userRole === "admin" ? "phase" : "live"}>
                            {item.userRole}
                          </Badge>
                        </div>
                        <span className="truncate font-mono text-xs text-steel">{secondary}</span>
                      </div>
                      <time className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                        {formatDate(item.createdAt)}
                        {edited && " · edited"}
                      </time>
                    </div>
                    {isEditing ? (
                      <div className="mt-2.5 space-y-3">
                        <textarea
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          aria-label="Edit checkpoint note"
                          className="w-full rounded-xl border border-hairline bg-canvas p-3 text-sm outline-none transition-colors focus:border-ink"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setDraft("");
                            }}
                            disabled={isSaving}
                            className="press inline-flex h-9 items-center justify-center rounded-full border border-hairline px-4 text-sm font-medium text-charcoal transition-colors hover:border-ink disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdate(item)}
                            disabled={isSaving || !draft.trim()}
                            className="press inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                        {item.note}
                      </p>
                    )}
                    {canModerate(item) && !isEditing && (
                      <div className="mt-3 flex justify-end gap-2">
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
