"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UploadProgressBar, formatBytes } from "@/components/UploadProgressBar";
import { CheckIcon, CloseIcon, UploadIcon } from "@/components/icons";

/* ── Types ─────────────────────────────────────────────────────────── */

export type UploadJobStatus = "uploading" | "finalizing" | "done" | "error";

export interface UploadJob {
  id: string;
  label: string;
  sizeBytes: number;
  sentBytes: number;
  status: UploadJobStatus;
  error: string | null;
}

export type UploadMode = "background" | "foreground";

const MODE_KEY = "vaayu:upload:mode";
/** Resumable chunks must be multiples of 256 KB (except the final one). */
const CHUNK_BYTES = 8 * 1024 * 1024;
/** Brief "all done" beat before the toast auto-hides (Drive behavior). */
const DONE_HIDE_MS = 5000;

/* ── Preference (localStorage, per browser) ────────────────────────── */

export function useUploadMode(): [UploadMode, (mode: UploadMode) => void] {
  const [mode, setModeState] = useState<UploadMode>("background");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (saved === "foreground" || saved === "background") {
        setModeState(saved);
      }
    } catch {
      // Private mode etc. — background default still applies in memory.
    }
  }, []);
  const setMode = useCallback((next: UploadMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // Non-fatal: preference just won't persist.
    }
  }, []);
  return [mode, setMode];
}

/* ── Direct browser→Google chunked upload ──────────────────────────── */

function googleErrorMessage(status: number, body: string): string {
  let message: string | null = null;
  let reason = "";
  try {
    const data = JSON.parse(body) as {
      error?: { message?: unknown; errors?: { reason?: unknown }[] };
    };
    if (typeof data?.error?.message === "string" && data.error.message) {
      message = data.error.message;
    }
    const r = data?.error?.errors?.[0]?.reason;
    if (typeof r === "string") reason = r;
  } catch {
    // Fall through to the generic message.
  }
  const hay = `${reason} ${message ?? ""}`.toLowerCase();
  if (
    status === 403 &&
    (reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded" ||
      reason === "dailyLimitExceeded" ||
      reason === "quotaExceeded" ||
      hay.includes("daily limit") ||
      hay.includes("upload limit") ||
      hay.includes("rate limit"))
  ) {
    return "Google Drive's daily upload limit (750 GB per day) has been reached. No more uploads will succeed until it resets in about 24 hours. Please try again tomorrow.";
  }
  if (status === 413 || /storage quota/i.test(hay)) {
    return status === 413
      ? "This file exceeds Google Drive's 5 TB single-file limit and cannot be uploaded."
      : "Google Drive storage is full, so this upload was rejected. Free up space in Drive and try again.";
  }
  if (message) {
    return `Drive rejected the upload: ${message.slice(0, 160)}`;
  }
  return `Drive rejected the upload (HTTP ${status}). Please retry.`;
}

/** PUT one chunk; resolves 308 (more to come) vs 200/201 (file complete). */
function putChunk(
  sessionUri: string,
  chunk: Blob,
  start: number,
  endInclusive: number,
  total: number,
  onProgress: (loaded: number) => void
): Promise<{ complete: boolean; fileId: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUri);
    // NOTE: Content-Length must NOT be set manually (forbidden header —
    // the browser sets it). Content-Range drives the resumable protocol.
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${start}-${endInclusive}/${total}`
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status === 308) {
        resolve({ complete: false, fileId: null });
        return;
      }
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText) as { id?: unknown };
          resolve({
            complete: true,
            fileId: typeof data.id === "string" ? data.id : null,
          });
        } catch {
          reject(new Error("Drive did not return a file record."));
        }
        return;
      }
      reject(new Error(googleErrorMessage(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () =>
      reject(
        new Error("Network error during upload. Check your connection and retry.")
      );
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Please retry."));
    xhr.timeout = 120000;
    xhr.send(chunk);
  });
}

/**
 * PUT a 0-byte file to a resumable session: a single empty request with
 * `Content-Range: bytes *\/0` completes it. (The chunk loop below would run
 * zero iterations for empty files, so they need this dedicated path —
 * empty files are real uploads: .gitkeep, placeholders, etc.)
 */
function putEmptyFile(sessionUri: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUri);
    xhr.setRequestHeader("Content-Range", "bytes */0");
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText) as { id?: unknown };
          resolve(typeof data.id === "string" ? data.id : null);
        } catch {
          reject(new Error("Drive did not return a file record."));
        }
        return;
      }
      reject(new Error(googleErrorMessage(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () =>
      reject(
        new Error("Network error during upload. Check your connection and retry.")
      );
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Please retry."));
    xhr.timeout = 120000;
    xhr.send(new Blob([]));
  });
}

/**
 * Upload a File's bytes straight to Google Drive via a server-minted
 * resumable session (folder lock pinned server-side at mint time).
 * onProgress receives cumulative bytes sent — always real XHR numbers.
 *
 * Pass `relativePath` (e.g. "myproj/src/a.ts" from a folder pick or
 * drop) to recreate the file's subfolders strictly inside the locked
 * Drive folder. Every file type and every size up to Drive's own 5 TB
 * ceiling is accepted — the app adds no caps of its own.
 */
export async function uploadFileToDrive(
  file: File,
  onProgress: (sentBytes: number) => void,
  opts?: { relativePath?: string }
): Promise<{
  driveFileId: string;
  name: string;
  size: number;
  parentFolderId: string | null;
  topFolderId: string | null;
}> {
  const mintRes = await fetch("/api/drive/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      ...(opts?.relativePath ? { relativePath: opts.relativePath } : {}),
    }),
  });
  const mint = (await mintRes.json().catch(() => null)) as {
    sessionUri?: unknown;
    fileName?: unknown;
    parentFolderId?: unknown;
    topFolderId?: unknown;
    error?: unknown;
  } | null;
  if (!mintRes.ok || typeof mint?.sessionUri !== "string") {
    throw new Error(
      typeof mint?.error === "string" && mint.error
        ? mint.error
        : "Could not start the upload session."
    );
  }
  const parentFolderId =
    typeof mint.parentFolderId === "string" ? mint.parentFolderId : null;
  const topFolderId =
    typeof mint.topFolderId === "string" ? mint.topFolderId : null;
  const name = typeof mint.fileName === "string" ? mint.fileName : file.name;

  if (file.size === 0) {
    onProgress(0);
    const fileId = await putEmptyFile(mint.sessionUri);
    if (!fileId) {
      throw new Error("Drive did not return a file record.");
    }
    return { driveFileId: fileId, name, size: 0, parentFolderId, topFolderId };
  }

  let sent = 0;
  onProgress(0);
  for (let start = 0; start < file.size; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES - 1, file.size - 1);
    const chunk = file.slice(start, end + 1);
    const result = await putChunk(
      mint.sessionUri,
      chunk,
      start,
      end,
      file.size,
      (loaded) => {
        sent = start + loaded;
        onProgress(Math.min(sent, file.size));
      }
    );
    sent = end + 1;
    onProgress(sent);
    if (result.complete) {
      if (!result.fileId) {
        throw new Error("Drive did not return a file record.");
      }
      return {
        driveFileId: result.fileId,
        name,
        size: file.size,
        parentFolderId,
        topFolderId,
      };
    }
  }
  throw new Error("Upload ended without confirmation from Drive.");
}

/* ── Context ───────────────────────────────────────────────────────── */

export type TrackedTask = (
  report: (sentBytes: number) => void,
  setFinalizing: () => void
) => Promise<void>;

interface UploadContextValue {
  jobs: UploadJob[];
  track: (
    label: string,
    sizeBytes: number,
    task: TrackedTask
  ) => { id: string; finished: Promise<void> };
  retryJob: (id: string) => void;
  dismissJob: (id: string) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploads(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads must be used inside <UploadProvider>.");
  return ctx;
}

let jobSeq = 0;

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const tasks = useRef(new Map<string, TrackedTask>());

  const updateJob = useCallback(
    (id: string, patch: Partial<UploadJob>) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    },
    []
  );

  const runTask = useCallback(
    (id: string) => {
      const task = tasks.current.get(id);
      if (!task) return Promise.resolve();
      updateJob(id, { status: "uploading", sentBytes: 0, error: null });
      const report = (sentBytes: number) => updateJob(id, { sentBytes });
      const setFinalizing = () => updateJob(id, { status: "finalizing" });
      return task(report, setFinalizing).then(
        () => {
          updateJob(id, { status: "done" });
        },
        (err: unknown) => {
          updateJob(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed.",
          });
          throw err;
        }
      );
    },
    [updateJob]
  );

  const track = useCallback(
    (label: string, sizeBytes: number, task: TrackedTask) => {
      jobSeq += 1;
      const id = `upload-${Date.now()}-${jobSeq}`;
      tasks.current.set(id, task);
      setJobs((prev) => [
        ...prev,
        {
          id,
          label,
          sizeBytes,
          sentBytes: 0,
          status: "uploading",
          error: null,
        },
      ]);
      setOpen(true);
      const finished = runTask(id);
      // Swallow here — callers awaiting `finished` still observe rejection,
      // and the job row itself always surfaces the error.
      finished.catch(() => {});
      return { id, finished };
    },
    [runTask]
  );

  const retryJob = useCallback(
    (id: string) => {
      if (!tasks.current.has(id)) return;
      setOpen(true);
      runTask(id).catch(() => {});
    },
    [runTask]
  );

  const dismissJob = useCallback((id: string) => {
    tasks.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  // Drive behavior: brief "done" beat, then auto-hide (errors stay put).
  useEffect(() => {
    if (jobs.length === 0) return;
    const active = jobs.some(
      (j) => j.status === "uploading" || j.status === "finalizing"
    );
    const failed = jobs.some((j) => j.status === "error");
    if (active || failed) return;
    const timer = setTimeout(() => {
      setOpen(false);
      setJobs([]);
      tasks.current.clear();
    }, DONE_HIDE_MS);
    return () => clearTimeout(timer);
  }, [jobs]);

  const value = useMemo(
    () => ({ jobs, track, retryJob, dismissJob }),
    [jobs, track, retryJob, dismissJob]
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
      <UploadToast
        jobs={jobs}
        open={open}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onClose={() => {
          setOpen(false);
          // Keep errors + active jobs; prune finished ones.
          setJobs((prev) =>
            prev.filter(
              (j) => j.status === "uploading" || j.status === "finalizing" || j.status === "error"
            )
          );
        }}
        onRetry={retryJob}
        onDismiss={dismissJob}
      />
    </UploadContext.Provider>
  );
}

/* ── Global bottom-right toast ─────────────────────────────────────── */

function UploadToast({
  jobs,
  open,
  collapsed,
  onToggleCollapsed,
  onClose,
  onRetry,
  onDismiss,
}: {
  jobs: UploadJob[];
  open: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (!open || jobs.length === 0) return null;

  const total = jobs.reduce((s, j) => s + j.sizeBytes, 0);
  const sent = jobs.reduce((s, j) => s + Math.min(j.sentBytes, j.sizeBytes), 0);
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const failedCount = jobs.filter((j) => j.status === "error").length;
  const allDone = jobs.every((j) => j.status === "done");
  const headline = allDone
    ? `Uploaded ${jobs.length} ${jobs.length === 1 ? "file" : "files"}`
    : failedCount > 0
      ? `${failedCount} upload${failedCount === 1 ? "" : "s"} failed`
      : `Uploading ${doneCount} of ${jobs.length} · ${pct}%`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[80] w-[min(380px,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl"
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
            allDone ? "bg-success-text text-white" : "bg-ink text-white"
          }`}
        >
          {allDone ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <UploadIcon className="h-4 w-4" />
          )}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {headline}
        </p>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand uploads" : "Collapse uploads"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-steel transition-colors hover:bg-fog hover:text-ink"
        >
          <span
            className={`inline-block text-xs transition-transform duration-200 ${
              collapsed ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            ▾
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss uploads"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-steel transition-colors hover:bg-fog hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-64 space-y-3 overflow-y-auto border-t border-hairline-soft px-4 py-3">
          <UploadProgressBar
            segments={jobs.map((j) => ({
              label: j.id,
              doneBytes: j.status === "done" ? j.sizeBytes : j.sentBytes,
              totalBytes: j.sizeBytes,
              failed: j.status === "error",
            }))}
          />
          {jobs.map((j) => (
            <div key={j.id} className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13px] font-medium text-ink">
                  {j.label}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-stone">
                  {j.status === "done" ? (
                    <span className="text-success-text">Complete · {formatBytes(j.sizeBytes)}</span>
                  ) : j.status === "error" ? (
                    <span className="text-error">{j.error ?? "Failed"}</span>
                  ) : j.status === "finalizing" ? (
                    "Saving…"
                  ) : (
                    `${formatBytes(Math.min(j.sentBytes, j.sizeBytes))} of ${formatBytes(j.sizeBytes)}`
                  )}
                </p>
              </div>
              {j.status === "error" ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRetry(j.id)}
                    className="rounded-full border border-hairline px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-ink"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(j.id)}
                    aria-label={`Dismiss ${j.label}`}
                    className="grid h-7 w-7 place-items-center rounded-full text-stone transition-colors hover:bg-fog hover:text-ink"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                j.status === "done" && (
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                )
              )}
            </div>
          ))}
        </div>
      )}

      {collapsed && (
        <div
          className="h-1 w-full bg-hairline-soft"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className={`h-full transition-[width] duration-200 ${
              failedCount > 0 ? "bg-error" : allDone ? "bg-success-text" : "bg-ink"
            }`}
            style={{ width: `${allDone ? 100 : pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
