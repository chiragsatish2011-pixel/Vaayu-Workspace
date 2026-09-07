"use client";

export interface ProgressSegment {
  label: string;
  doneBytes: number;
  totalBytes: number;
  failed?: boolean;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * GitHub-style batch progress: stacked per-file segments (width ∝ file size,
 * fill ∝ bytes sent) plus an honest "n of m files · p%" caption. Every number
 * comes from live upload state — nothing simulated.
 *
 * Pass `caption` to override the files caption (e.g. a batch job that
 * represents thousands of files reports its own file counts).
 */
export function UploadProgressBar({
  segments,
  caption,
  className = "",
}: {
  segments: ProgressSegment[];
  caption?: string;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(s.totalBytes, 0), 0);
  const done = segments.reduce(
    (sum, s) => sum + Math.min(Math.max(s.doneBytes, 0), Math.max(s.totalBytes, 0)),
    0
  );
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const filesDone = segments.filter(
    (s) => s.totalBytes > 0 && s.doneBytes >= s.totalBytes && !s.failed
  ).length;
  const hasFailure = segments.some((s) => s.failed);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-steel">
          {caption ??
            `${filesDone} of ${segments.length} ${
              segments.length === 1 ? "file" : "files"
            }`}
        </p>
        <p
          className={`font-mono text-[11px] font-semibold tabular-nums ${
            hasFailure ? "text-error" : "text-ink"
          }`}
        >
          {pct}%
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-2 flex h-2 w-full gap-[3px] overflow-hidden"
      >
        {segments.map((s) => {
          const widthPct =
            total > 0 ? Math.max((s.totalBytes / total) * 100, 4) : 100;
          const fillPct =
            s.totalBytes > 0
              ? Math.min(100, (Math.min(s.doneBytes, s.totalBytes) / s.totalBytes) * 100)
              : 0;
          return (
            <div
              key={s.label}
              title={`${s.label} — ${fillPct}%`}
              className="h-full overflow-hidden rounded-full bg-hairline-soft"
              style={{ width: `${widthPct}%` }}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                  s.failed ? "bg-error" : fillPct >= 100 ? "bg-success-text" : "bg-ink"
                }`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs tabular-nums text-steel">
        {formatBytes(done)} of {formatBytes(total)}
      </p>
    </div>
  );
}
