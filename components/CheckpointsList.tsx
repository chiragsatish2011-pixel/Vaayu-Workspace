"use client";

import { useState } from "react";
import { Badge } from "@/components/Badge";

export interface CheckpointItem {
  id: string;
  note: string;
  createdAt: string | Date;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
}

const EXAMPLE_NOTES = [
  "made landingpage of vaayu smoother",
  "updates design theme in mobile app",
  "fixed loading state bug",
  "added checkpoints section for team progress",
];

export function CheckpointsList({ initialItems }: { initialItems: CheckpointItem[] }) {
  const [items, setItems] = useState<CheckpointItem[]>(initialItems);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-8">
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
              const formattedDate = new Date(item.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
              const initial = (item.userEmail?.[0] ?? "?").toUpperCase();

              return (
                <div key={item.id} className="relative flex items-start gap-4">
                  {/* Timeline dot/avatar */}
                  <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink font-display text-xs font-bold text-white shadow-sm ring-4 ring-canvas sm:h-10 sm:w-10 sm:text-sm">
                    {initial}
                  </span>

                  {/* Content card */}
                  <div className="flex-1 rounded-xl border border-hairline bg-fog/50 p-4 transition-colors hover:bg-fog">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft/60 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {item.userEmail}
                        </span>
                        <Badge tone={item.userRole === "admin" ? "phase" : "live"}>
                          {item.userRole}
                        </Badge>
                      </div>
                      <time className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                        {formattedDate}
                      </time>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                      {item.note}
                    </p>
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
