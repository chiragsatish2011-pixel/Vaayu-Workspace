"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Badge";
import {
  collectFilesFromDrop,
  collectFilesFromInput,
  pickedBatchBytes,
  pickedBatchRoots,
  type PickedUploadFile,
} from "@/components/folderWalk";
import { formatBytes } from "@/components/UploadProgressBar";
import {
  BoxIcon,
  CheckIcon,
  FolderIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { UploadProgressBar } from "@/components/UploadProgressBar";
import {
  uploadFileToDrive,
  useUploadMode,
  useUploads,
  type FileProgress,
} from "@/components/UploadManager";
import { FileBrowser } from "@/components/FileBrowser";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { StartContextCall } from "@/components/calls/StartContextCall";

export interface ProjectItem {
  id: string;
  title: string;
  description: string;
  codebaseDriveId: string;
  codebaseFileName: string;
  codebaseFileSize: string;
  previewDriveId: string | null;
  previewFileName: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  userDisplayName?: string | null;
  userAvatarDriveId?: string | null;
}

interface ProjectsManagerProps {
  initialProjects: ProjectItem[];
  currentUser: {
    id: string;
    email: string;
    role: "admin" | "member";
    displayName?: string | null;
  };
}

export function ProjectsManager({
  initialProjects,
  currentUser,
}: ProjectsManagerProps) {
  const [projects, setProjects] = useState<ProjectItem[]>(initialProjects);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [browsingProject, setBrowsingProject] = useState<ProjectItem | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [codebaseMode, setCodebaseMode] = useState<"file" | "folder">("file");
  const [codebaseFile, setCodebaseFile] = useState<File | null>(null);
  // Folder mode: the ENTIRE picked/dropped tree — every file at every
  // depth, zero filtering. Uploaded as one batch preserving relativePath.
  const [folderFiles, setFolderFiles] = useState<PickedUploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [scanningDrop, setScanningDrop] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Foreground mode: job ids of the in-flight batch, rendered inline.
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [savingRecord, setSavingRecord] = useState(false);

  const { jobs, track } = useUploads();
  const [uploadMode] = useUploadMode();
  const router = useRouter();

  // ── Reconciliation: Drive vs DB (state-sync fix) ──────────────────
  // The UI's project list comes from the DB (app/projects/page.tsx).
  // If a batch uploads files to Drive but the final POST /api/projects
  // never runs (network error, tab closed, 0% bug), Drive holds files
  // that the DB never recorded → UI shows "nothing". This state fetches
  // the real Drive listing and surfaces orphaned items so the user can
  // recover them without re-uploading 27k files.
  const [orphans, setOrphans] = useState<
    { id: string; name: string; mimeType: string; size?: string }[]
  >([]);
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [orphansError, setOrphansError] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  const refreshOrphans = async () => {
    setOrphansLoading(true);
    setOrphansError(null);
    try {
      const res = await fetch("/api/drive/list", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not list Drive folder.");
      const driveFiles: { id: string; name: string; mimeType: string; size?: string }[] =
        Array.isArray(data?.files) ? data.files : [];
      // A Drive item is orphaned if its ID appears nowhere in the DB
      // projects table (as codebase or preview). That means it landed in
      // Drive but the lump DB insert never ran.
      const knownIds = new Set<string>();
      for (const p of projects) {
        if (p.codebaseDriveId) knownIds.add(p.codebaseDriveId);
        if (p.previewDriveId) knownIds.add(p.previewDriveId);
      }
      const orphaned = driveFiles.filter((f) => !knownIds.has(f.id));
      setOrphans(orphaned);
    } catch (err) {
      setOrphansError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setOrphansLoading(false);
    }
  };

  // Fetch once on mount and whenever projects change (so newly recovered
  // items disappear from the orphan list immediately).
  useEffect(() => {
    refreshOrphans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length]);

  // ── Upload tuning (research-backed) ──────────────────────────────
  /** Controlled parallelism: 3 concurrent file uploads (Drive rate limit safe). Chunk size is 8MB (UploadManager.tsx:CHUNK_BYTES, 32×256KB). */
  const UPLOAD_CONCURRENCY = 3;

  const handleRecoverOrphan = async (driveFile: {
    id: string;
    name: string;
    mimeType: string;
  }) => {
    const titleGuess = driveFile.name.replace(/\/$/, "") || "Recovered project";
    const descriptionGuess = `Recovered from Drive after interrupted upload — ${driveFile.name} was in Drive but had no project record. Created via Sync with Drive.`;
    setRecoveringId(driveFile.id);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleGuess.slice(0, 100),
          description: descriptionGuess.slice(0, 1000),
          codebase: { driveFileId: driveFile.id },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to recover project.");
      handleProjectLanded(data.project as ProjectItem);
      // Remove from orphan list optimistically
      setOrphans((prev) => prev.filter((o) => o.id !== driveFile.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Recovery failed.");
    } finally {
      setRecoveringId(null);
    }
  };

  const codebaseInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);

  // The folder picker needs a real folder-select input: React has no
  // webkitdirectory prop, so the attribute is set imperatively. The OS
  // folder picker then returns every file with webkitRelativePath intact.
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, [isModalOpen]);

  const handlePreviewChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPreviewFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleCodebaseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCodebaseFile(file);
      setFolderFiles([]);
    }
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = collectFilesFromInput(e.target.files);
    if (picked.length > 0) {
      // One folder picked = the whole tree as one batch. Nothing is
      // filtered out — every nested file at every depth is kept.
      setFolderFiles(picked);
      setCodebaseFile(null);
      if (codebaseInputRef.current) codebaseInputRef.current.value = "";
      setFormError(null);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (codebaseMode !== "folder") return;
    setScanningDrop(true);
    setFormError(null);
    try {
      // Recursive DataTransferItem walk: a dropped folder resolves to its
      // ENTIRE contents (all files, all subfolders, all depths) — never a
      // single drilled-down file.
      const picked = await collectFilesFromDrop(e.dataTransfer);
      if (picked.length === 0) {
        setFormError("That drop contained no files — try a different folder.");
        return;
      }
      setFolderFiles(picked);
      setCodebaseFile(null);
      if (codebaseInputRef.current) codebaseInputRef.current.value = "";
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not read the dropped folder."
      );
    } finally {
      setScanningDrop(false);
    }
  };

  const clearFolderSelection = () => {
    setFolderFiles([]);
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCodebaseMode("file");
    setCodebaseFile(null);
    setFolderFiles([]);
    setDragActive(false);
    setScanningDrop(false);
    setPreviewFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setFormError(null);
    setBatchIds(null);
    setSavingRecord(false);
    if (codebaseInputRef.current) codebaseInputRef.current.value = "";
    if (previewInputRef.current) previewInputRef.current.value = "";
  };

  const handleCloseModal = () => {
    if (submitting) return;
    resetForm();
    setIsModalOpen(false);
  };

  /**
   * Upload one batch of files as globally tracked jobs (visible in the
   * bottom-right toast across all routes). Returns Drive file refs keyed by
   * form field. Throws the first upload error.
   */
  const uploadBatch = async (
    files: Array<{ key: string; file: File }>
  ): Promise<Record<string, { driveFileId: string; name: string; size: number }>> => {
    const results: Record<string, { driveFileId: string; name: string; size: number }> = {};
    const ids: string[] = [];
    const pending = files.map(({ key, file }) => {
      const { id, finished } = track(file.name, file.size, async (report, setFinalizing) => {
        const uploaded = await uploadFileToDrive(file, report);
        setFinalizing();
        results[key] = uploaded;
      });
      ids.push(id);
      return finished;
    });
    setBatchIds(ids);
    await Promise.all(pending);
    return results;
  };

  const recordProject = async (
    snapshot: { title: string; description: string },
    ids: Record<string, { driveFileId: string }>
  ): Promise<ProjectItem> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: snapshot.title,
        description: snapshot.description,
        codebase: { driveFileId: ids.codebase.driveFileId },
        ...(ids.preview
          ? { preview: { driveFileId: ids.preview.driveFileId } }
          : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Failed to publish project."
      );
    }
    return data.project as ProjectItem;
  };

  const handleProjectLanded = (project: ProjectItem) => {
    setProjects((prev) => [project, ...prev]);
    router.refresh();
  };

  /**
   * Upload one picked folder tree with CONTROLLED PARALLELISM inside a
   * caller-owned tracked job. Each file carries its relativePath so the
   * server recreates the exact subfolder structure inside the locked Drive
   * folder. Returns the tree's top-level Drive folder id plus every
   * uploaded file id.
   *
   * RESEARCH-BACKED FIX (was sequential — primary bottleneck for 27k files):
   * - Concurrency capped at UPLOAD_CONCURRENCY=3 (Drive best-practice for
   *   single credential; higher triggers 429, not speed).
   * - Chunk size 8MB (RESUMABLE_CHUNK_BYTES, multiple of 256KB) for large
   *   files — fewer HTTP requests, less overhead.
   * - Per-file success/failure tracked as each file completes (out-of-order
   *   safe) — preserves state-sync fix (partial → still create project).
   * - Aggregated progress across all in-flight files (sum of per-file sent).
   * - Exponential backoff on 429/5xx + dynamic concurrency reduction if
   *   sustained throttling detected.
   */
  const runFolderUpload = async (
    picked: PickedUploadFile[],
    report: (sentBytes: number, files?: FileProgress) => void,
    sentBaseRef: { value: number }
  ): Promise<{
    topFolderId: string | null;
    fileIds: string[];
    failed: { path: string; error: string }[];
    succeeded: number;
  }> => {
    let topFolderId: string | null = null;
    const fileIds: string[] = [];
    const failed: { path: string; error: string }[] = [];
    // Concurrency control — research says 3 is optimal for Drive single cred
    let concurrency = UPLOAD_CONCURRENCY;
    let consecutiveRateLimits = 0;

    // Per-file progress tracking for aggregate reporting
    const perFileSent = new Map<number, number>();
    const perFileDone = new Set<number>();
    const totalBytes = picked.reduce((s, f) => s + f.file.size, 0);

    const updateAggregateProgress = () => {
      let agg = 0;
      for (let i = 0; i < picked.length; i++) {
        if (perFileDone.has(i)) agg += picked[i]!.file.size;
        else agg += perFileSent.get(i) || 0;
      }
      // sentBaseRef tracks completed bytes for caller's final consistent value,
      // but we report aggregate for UI smoothness
      // File counts ride along so the toast shows "N of 3468 files"
      // instead of "0 of 1" (one batch job = thousands of files).
      report(agg, {
        done: perFileDone.size,
        total: picked.length,
        failed: failed.length,
      });
    };

    // Shared queue index
    let nextIdx = 0;
    const getNext = (): number | null => {
      if (nextIdx >= picked.length) return null;
      return nextIdx++;
    };

    const uploadOne = async (idx: number): Promise<void> => {
      const item = picked[idx]!;
      let uploaded: Awaited<ReturnType<typeof uploadFileToDrive>> | null = null;
      let lastErr: unknown = null;
      // Exponential backoff for rate-limit/5xx — not just flat retry
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          uploaded = await uploadFileToDrive(
            item.file,
            (sent) => {
              perFileSent.set(idx, sent);
              updateAggregateProgress();
            },
            { relativePath: item.relativePath }
          );
          lastErr = null;
          consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const statusMatch = msg.match(/\(HTTP (\d{3})\)/);
          const status = statusMatch ? parseInt(statusMatch[1]) : 0;
          const isRateLimit = status === 429 || /429|rateLimit|quotaExceeded|dailyLimit|userRateLimit/i.test(msg);
          const is5xx = status >= 500 && status < 600;
          const isTransient = /Network error|timed out|Could not start|rateLimit|429|5\d{2}/i.test(msg);
          if (!isTransient || attempt >= 2) break;
          // Exponential backoff: 800ms, 1600ms, 3200ms + jitter
          const backoff = 800 * Math.pow(2, attempt) + Math.random() * 200;
          if (isRateLimit || is5xx) {
            consecutiveRateLimits++;
            // If sustained throttling, reduce concurrency for remainder of batch
            if (consecutiveRateLimits >= 3 && concurrency > 1) {
              concurrency = Math.max(1, concurrency - 1);
              console.warn(`[ProjectsManager] sustained 429/5xx — reducing concurrency to ${concurrency}`);
            }
          }
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      if (uploaded) {
        perFileDone.add(idx);
        perFileSent.set(idx, item.file.size);
        updateAggregateProgress();
        // Synchronize shared state — topFolderId and fileIds need atomic updates
        // Use a simple lock via queue: since we have multiple workers, protect with
        // a microtask — JS is single-threaded, so push is atomic if we don't await between read/write
        fileIds.push(uploaded.driveFileId);
        if (!topFolderId && uploaded.topFolderId) {
          topFolderId = uploaded.topFolderId;
        }
      } else {
        const msg = lastErr instanceof Error ? lastErr.message : "Upload failed";
        perFileDone.add(idx);
        perFileSent.set(idx, item.file.size);
        updateAggregateProgress();
        failed.push({ path: item.relativePath, error: msg });
      }
    };

    // Emit totals before the first byte so the toast reads "0 of N files"
    // from the first paint instead of flashing "0 of 1".
    report(sentBaseRef.value, { done: 0, total: picked.length, failed: 0 });
    // Worker pool with controlled concurrency and pacing
    const workers: Promise<void>[] = [];
    // Throttled release: don't fire all at once, pace initial bursts 40ms apart
    for (let w = 0; w < Math.min(concurrency, picked.length); w++) {
      workers.push(
        (async () => {
          while (true) {
            const idx = getNext();
            if (idx === null) break;
            // Pacing: stagger start by 40ms to avoid quota spike
            if (idx >= concurrency) await new Promise((r) => setTimeout(r, 40));
            await uploadOne(idx);
            // If concurrency was reduced mid-batch, workers will naturally drain
            // without spawning new ones; we don't dynamically add workers.
          }
        })()
      );
    }
    await Promise.all(workers);

    // Ensure final report is total
    const finalTotal = picked.reduce((s, f) => s + f.file.size, 0);
    // sentBaseRef is kept for caller compatibility — set to total of succeeded+failed
    sentBaseRef.value = finalTotal;
    report(finalTotal, {
      done: perFileDone.size,
      total: picked.length,
      failed: failed.length,
    });

    return { topFolderId, fileIds, failed, succeeded: fileIds.length };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError("Project title is required.");
      return;
    }
    if (!description.trim()) {
      setFormError("Project description is required.");
      return;
    }
    const isFolderMode = codebaseMode === "folder";
    if (!isFolderMode && !codebaseFile) {
      setFormError("Please select a project file.");
      return;
    }
    if (isFolderMode && folderFiles.length === 0) {
      setFormError(
        "Please choose a folder or drop one below — its entire contents will upload."
      );
      return;
    }

    const singleFiles = [
      ...(!isFolderMode && codebaseFile
        ? [{ key: "codebase", file: codebaseFile }]
        : []),
      ...(previewFile ? [{ key: "preview", file: previewFile }] : []),
    ];
    const totalBytes =
      (isFolderMode ? pickedBatchBytes(folderFiles) : 0) +
      singleFiles.reduce((sum, f) => sum + f.file.size, 0);
    const snapshot = { title: title.trim(), description: description.trim() };
    const jobLabel = isFolderMode
      ? `Publish "${snapshot.title}" (${folderFiles.length} files)`
      : `Publish "${snapshot.title}"`;

    // Foreground mode (Settings opt-in): modal stays open with live progress.
    if (uploadMode === "foreground") {
      setSubmitting(true);
      setFormError(null);
      try {
        // Single-file mode reuses the per-field batch; folder mode uploads
        // the whole tree (plus the optional preview) inside one batch job.
        const ids: Record<string, { driveFileId: string; name: string; size: number }> =
          isFolderMode ? {} : await uploadBatch(singleFiles);
        if (isFolderMode) {
          let partialWarning: string | null = null;
          const folderJob = track(jobLabel, totalBytes, async (report) => {
            const sentBaseRef = { value: 0 };
            const tree = await runFolderUpload(folderFiles, report, sentBaseRef);
            // Preview (if any) uploads after the tree, continuing progress.
            // Preview failure should not abort the whole folder project — it is optional.
            for (const { key, file } of singleFiles) {
              try {
                const uploaded = await uploadFileToDrive(file, (sent) => {
                  report(sentBaseRef.value + sent);
                });
                sentBaseRef.value += file.size;
                report(sentBaseRef.value);
                ids[key] = uploaded;
              } catch (err) {
                // Preview is optional — log and continue with codebase only
                console.warn(`[ProjectsManager] preview upload failed:`, err);
                sentBaseRef.value += file.size;
                report(sentBaseRef.value);
              }
            }
            const codebaseId = tree.topFolderId ?? tree.fileIds[0];
            if (!codebaseId) {
              const firstErr = tree.failed[0]?.error || "Folder upload produced no files.";
              throw new Error(
                `All ${tree.failed.length} files failed (${firstErr}). ${tree.failed.length} of ${folderFiles.length} files did not reach Drive — check your connection and try again, or check Drive folder directly for any partial uploads and use "Sync with Drive" to reconcile.`
              );
            }
            ids.codebase = {
              driveFileId: codebaseId,
              name: "",
              size: 0,
            };
            if (tree.failed.length > 0) {
              partialWarning = `Partial success: ${tree.succeeded}/${folderFiles.length} files reached Drive, ${tree.failed.length} failed. Project created with what succeeded. Missing (first 3): ${tree.failed
                .slice(0, 3)
                .map((f) => f.path)
                .join(", ")}${tree.failed.length > 3 ? " …" : ""} — check Drive or use Sync with Drive.`;
            }
          });
          setBatchIds((prev) => [...(prev ?? []), folderJob.id]);
          await folderJob.finished;
          // Bubble partial warning after the toast job completes. The project
          // itself is still created below so Drive/DB never silently diverge.
          if (partialWarning) {
            // Show as formError but do not abort project creation
            setFormError(partialWarning);
          }
        }
        setSavingRecord(true);
        const project = await recordProject(snapshot, ids);
        handleProjectLanded(project);
        handleCloseModal();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "An unexpected error occurred."
        );
      } finally {
        setSubmitting(false);
        setSavingRecord(false);
      }
      return;
    }

    // Background (default): close immediately, finish in the global toast.
    // STATE-SYNC FIX: even if the batch is interrupted, whatever *did*
    // land in Drive is still recorded as a project so the UI never
    // shows "nothing" while Drive holds 27k files. runFolderUpload
    // now returns partial successes, and we create the project from
    // those. The toast still surfaces the error for retry.
    handleCloseModal();
    const { finished } = track(
      jobLabel,
      totalBytes,
      async (report, setFinalizing) => {
        const sentBaseRef = { value: 0 };
        const ids: Record<string, { driveFileId: string; name: string; size: number }> = {};
        let partialFailed = 0;
        let partialSucceeded = 0;
        if (isFolderMode) {
          const tree = await runFolderUpload(folderFiles, report, sentBaseRef);
          const codebaseId = tree.topFolderId ?? tree.fileIds[0];
          if (!codebaseId) {
            const firstErr = tree.failed[0]?.error || "Folder upload produced no files.";
            throw new Error(
              `All ${tree.failed.length} files failed (${firstErr}). Check Drive folder directly — ${tree.failed.length} files did not reach Drive. Use "Sync with Drive" to reconcile.`
            );
          }
          ids.codebase = { driveFileId: codebaseId, name: "", size: 0 };
          partialFailed = tree.failed.length;
          partialSucceeded = tree.succeeded;
          if (partialFailed > 0) {
            console.warn(
              `[ProjectsManager][background] partial upload: ${partialSucceeded}/${folderFiles.length} succeeded, ${partialFailed} failed — still creating project from successes.`
            );
          }
        }
        for (const { key, file } of singleFiles) {
          try {
            const uploaded = await uploadFileToDrive(file, (sent) => {
              report(sentBaseRef.value + sent);
            });
            sentBaseRef.value += file.size;
            report(sentBaseRef.value);
            ids[key] = uploaded;
          } catch (err) {
            // Preview is optional — don't abort codebase project
            if (key === "preview") {
              console.warn(`[ProjectsManager] preview upload failed (background):`, err);
              sentBaseRef.value += file.size;
              report(sentBaseRef.value);
              continue;
            }
            throw err;
          }
        }
        setFinalizing();
        const project = await recordProject(snapshot, ids);
        report(totalBytes);
        handleProjectLanded(project);
        if (partialFailed > 0) {
          // Surface partial info on the toast's final state via console;
          // the project itself is visible so Drive/DB are now in sync.
          console.warn(
            `[ProjectsManager] project ${project.id} created with partial folder: ${partialSucceeded}/${folderFiles.length} files`
          );
        }
      }
    );
    finished.catch(() => {
      // Surfaced on the toast job row (with Retry); the modal is long gone.
    });
  };

  const handleDelete = async (projectId: string, projectTitle: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete "${projectTitle}" and its files from Google Drive?`
      )
    ) {
      return;
    }

    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete project.");
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.userEmail.toLowerCase().includes(q) ||
      p.codebaseFileName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      {/* ── Action Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-steel pointer-events-none" />
          <input
            type="text"
            placeholder="Search projects by name, description, author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl border border-hairline bg-canvas pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-steel focus:border-ink focus:outline-none transition-colors"
          />
        </div>

        {/* Upload Button */}
        <div className="flex items-center gap-3">
          <Badge tone="live" className="hidden sm:inline-flex">
            Drive Storage Active
          </Badge>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-charcoal transition-colors"
          >
            <BoxIcon className="h-4 w-4" />
            Publish Project
          </button>
        </div>
      </div>

      {/* ── Reconciliation Banner: Drive vs DB (state-sync fix) ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={refreshOrphans}
          disabled={orphansLoading}
          className="inline-flex items-center gap-2 rounded-full border border-hairline bg-canvas px-4 py-1.5 text-xs font-semibold text-steel hover:border-ink hover:text-ink disabled:opacity-50"
        >
          {orphansLoading ? "Syncing…" : "Sync with Drive"}
        </button>
        {orphans.length > 0 && (
          <span className="font-mono text-[11px] text-amber-700">
            {orphans.length} orphaned {orphans.length === 1 ? "item" : "items"} in Drive — {showOrphans ? "review below" : "not in projects"}
          </span>
        )}
        {orphansError && (
          <span className="font-mono text-[11px] text-error">{orphansError}</span>
        )}
        {orphans.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOrphans((v) => !v)}
            className="ml-auto text-xs font-semibold text-ink underline"
          >
            {showOrphans ? "Hide" : `Review (${orphans.length})`}
          </button>
        )}
      </div>
      {showOrphans && orphans.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Found {orphans.length} {orphans.length === 1 ? "item" : "items"} in Drive with no project record — likely from interrupted batch (e.g. “Vaayu core” 27k files). Recover without re-uploading.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            These files/folders landed in the locked Drive folder but the final DB insert never ran (network error at 0% + lump update). Click Recover to create a project entry pointing at the existing Drive item.
          </p>
          <ul className="mt-3 space-y-2">
            {orphans.slice(0, 20).map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{o.name}</p>
                  <p className="font-mono text-[11px] text-stone">
                    {o.mimeType === "application/vnd.google-apps.folder" ? "Folder" : o.mimeType} {o.size ? `· ${formatBytes(Number(o.size) || 0)}` : ""} · {o.id.slice(0, 8)}…
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRecoverOrphan(o)}
                  disabled={recoveringId === o.id}
                  className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
                >
                  {recoveringId === o.id ? "Recovering…" : "Recover"}
                </button>
              </li>
            ))}
          </ul>
          {orphans.length > 20 && (
            <p className="mt-2 text-xs text-amber-800">Showing 20 of {orphans.length} — additional items remain in Drive.</p>
          )}
        </div>
      )}

      {/* ── Projects Grid ── */}
      {filteredProjects.length === 0 ? (
        <div className="rounded-3xl border border-hairline-soft bg-fog/60 p-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-canvas border border-hairline shadow-sm text-steel">
            <BoxIcon className="h-7 w-7 text-ink" />
          </div>
          <h3 className="mt-4 font-display text-xl font-bold tracking-tight text-ink">
            {searchQuery ? "No matching projects found" : "No project bundles yet"}
          </h3>
          <p className="mt-2 text-sm text-steel max-w-md mx-auto">
            {searchQuery
              ? "Try tweaking your search term to find what you need."
              : "Publish your first project — a single file of any type, or an entire folder tree with its structure preserved, stored directly in Google Drive."}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-charcoal transition-colors"
            >
              <BoxIcon className="h-4 w-4" />
              Publish First Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((p) => {
            const canDelete = currentUser.role === "admin" || currentUser.id === p.userId;
            // Folder projects store the Drive folder name with a trailing
            // "/" (see POST /api/projects) — they browse in Drive, they
            // don't download as one file.
            const isFolderProject = p.codebaseFileName.endsWith("/");
            const previewImageUrl = p.previewDriveId
              ? `/api/drive/download?id=${encodeURIComponent(p.previewDriveId)}`
              : null;

            return (
              <div
                key={p.id}
                className="group flex flex-col justify-between rounded-3xl border border-hairline bg-canvas overflow-hidden hover:border-ink/50 hover:shadow-lg transition-all duration-300"
              >
                <div>
                  {/* Preview Image / Header Banner */}
                  <div className="relative aspect-video w-full overflow-hidden bg-fog border-b border-hairline-soft">
                    {previewImageUrl ? (
                      <div className="relative h-full w-full group/img cursor-pointer" onClick={() => setLightboxImage({ url: previewImageUrl, title: p.title })}>
                        {/* Placeholder stays underneath; a non-image preview
                            hides itself on error and reveals this banner. */}
                        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ff5530]/10 via-[#f9603a]/5 to-[#ea5ec1]/10">
                          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-canvas border border-hairline-soft text-steel shadow-sm">
                            <BoxIcon className="h-6 w-6 text-[#ff5530]" />
                          </div>
                        </div>
                        <img
                          src={previewImageUrl}
                          alt={p.title}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 bg-ink/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="rounded-full bg-white/90 backdrop-blur-sm px-3 py-1 text-xs font-semibold text-ink shadow-sm">
                            Click to Expand
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ff5530]/10 via-[#f9603a]/5 to-[#ea5ec1]/10">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-canvas border border-hairline-soft text-steel shadow-sm">
                          <BoxIcon className="h-6 w-6 text-[#ff5530]" />
                        </div>
                      </div>
                    )}

                    {/* Format Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="rounded-full bg-ink/80 backdrop-blur-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                        {isFolderProject
                          ? "FOLDER"
                          : (p.codebaseFileName.split(".").pop() ?? "file")
                              .toUpperCase()
                              .slice(0, 8)}
                      </span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-xl font-bold tracking-tight text-ink line-clamp-1">
                        {p.title}
                      </h3>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id, p.title)}
                          disabled={deletingId === p.id}
                          title="Delete Project"
                          className="text-stone hover:text-red-600 transition-colors p-1 -mr-1 rounded-lg hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-steel line-clamp-3 leading-relaxed whitespace-pre-wrap">
                      {p.description}
                    </p>

                    {/* File Info Pill */}
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-fog p-2.5 border border-hairline-soft">
                      <FolderIcon className="h-4 w-4 shrink-0 text-steel" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                        {p.codebaseFileName}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] font-medium text-stone">
                        {p.codebaseFileSize}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer & Download + Browse */}
                <div className="border-t border-hairline-soft p-5 bg-fog/40 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setBrowsingProject(p)}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-hairline bg-canvas py-2.5 px-4 text-xs font-semibold text-ink hover:border-ink"
                    >
                      <FolderIcon className="h-4 w-4" />
                      Browse files
                    </button>
                    {isFolderProject ? (
                      <a
                        href={`/api/drive/zip?id=${encodeURIComponent(p.codebaseDriveId)}&name=${encodeURIComponent(p.title)}`}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-ink py-2.5 px-4 text-xs font-semibold text-white hover:bg-charcoal text-center"
                      >
                        <BoxIcon className="h-4 w-4" />
                        Download zip
                      </a>
                    ) : (
                      <a
                        href={`/api/drive/download?id=${encodeURIComponent(p.codebaseDriveId)}`}
                        download
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-ink py-2.5 px-4 text-xs font-semibold text-white hover:bg-charcoal text-center"
                      >
                        <BoxIcon className="h-4 w-4" />
                        Download
                      </a>
                    )}
                  </div>
                  {/* Keep single-file direct download as secondary for folder projects that also need file view */}
                  {!isFolderProject && (
                    <p className="text-center font-mono text-[11px] text-stone">
                      Single file · {p.codebaseFileSize} — also browsable above
                    </p>
                  )}

                  {/* Contextual call */}
                  <div className="flex items-center gap-2">
                    <StartContextCall context="project" contextId={p.id} label="Start Call" />
                  </div>

                  {/* Author meta — displayName primary, email secondary, deterministic color */}
                  <div className="flex items-center justify-between text-xs text-stone pt-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar
                        displayName={p.userDisplayName}
                        email={p.userEmail}
                        avatarDriveId={p.userAvatarDriveId}
                        size={20}
                      />
                      <span className="min-w-0 flex flex-col leading-tight">
                        <span className="truncate font-semibold text-ink text-[11px]">
                          {getDisplayName(p.userDisplayName, p.userEmail)}
                        </span>
                        <span className="truncate font-mono text-[10px] text-steel">{p.userEmail}</span>
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider shrink-0 text-stone">
                      {new Date(p.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Publish Project Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-hairline bg-canvas p-6 sm:p-8 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between pb-4 border-b border-hairline-soft">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
                  Publish New Project
                </h2>
                <p className="mt-1 text-xs text-steel">
                  Upload any project file and metadata to your Google Drive backend.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={submitting}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-fog text-steel hover:text-ink transition-colors"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vaayu Core Client v1.0"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-2xl border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Description *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Summarize the codebase contents, key features, and instructions..."
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-2xl border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none transition-colors resize-y"
                />
              </div>

              {/* Codebase: single file OR entire folder tree */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Project Content *
                </label>
                <div className="mb-2 grid grid-cols-2 gap-2 rounded-2xl border border-hairline-soft bg-fog/50 p-1">
                  {(["file", "folder"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setCodebaseMode(mode);
                        setFormError(null);
                      }}
                      aria-pressed={codebaseMode === mode}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
                        codebaseMode === mode
                          ? "bg-ink text-white shadow-sm"
                          : "text-steel hover:text-ink"
                      }`}
                    >
                      {mode === "file" ? "Single file" : "Entire folder"}
                    </button>
                  ))}
                </div>

                {codebaseMode === "file" ? (
                  <div className="rounded-2xl border-2 border-dashed border-hairline hover:border-ink/60 bg-fog/50 p-4 transition-colors">
                    <input
                      ref={codebaseInputRef}
                      type="file"
                      required={codebaseMode === "file"}
                      onChange={handleCodebaseChange}
                      className="block w-full text-xs text-steel file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-ink file:text-white hover:file:bg-charcoal cursor-pointer"
                    />
                    {codebaseFile && (
                      <p className="mt-2 text-xs font-mono text-ink">
                        Selected: <strong>{codebaseFile.name}</strong> (
                        {formatBytes(codebaseFile.size)})
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-stone">
                      Any file type, up to Google Drive&apos;s 5 TB per-file limit.
                    </p>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${
                      dragActive
                        ? "border-ink bg-fog"
                        : "border-hairline hover:border-ink/60 bg-fog/50"
                    }`}
                  >
                    <input
                      ref={folderInputRef}
                      type="file"
                      onChange={handleFolderInputChange}
                      className="hidden"
                      aria-label="Choose a folder to upload"
                    />
                    <div className="flex flex-col items-center gap-2 py-2 text-center">
                      <p className="text-sm font-semibold text-ink">
                        {scanningDrop
                          ? "Reading dropped folder…"
                          : "Drop a folder here, or"}
                      </p>
                      {!scanningDrop && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => folderInputRef.current?.click()}
                          className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50 transition-colors"
                        >
                          Choose Folder…
                        </button>
                      )}
                      <p className="max-w-sm text-[11px] leading-relaxed text-stone">
                        The picked folder always uploads in full — every file,
                        every subfolder, every depth level. Nothing is skipped.
                        Structure is recreated inside the team Drive folder.
                      </p>
                    </div>
                    {folderFiles.length > 0 && (
                      <div className="mt-3 rounded-xl border border-hairline-soft bg-canvas p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-mono text-ink">
                            <strong>{folderFiles.length}</strong>{" "}
                            {folderFiles.length === 1 ? "file" : "files"} ·{" "}
                            {formatBytes(pickedBatchBytes(folderFiles))}
                            <span className="text-stone">
                              {" "}
                              — {pickedBatchRoots(folderFiles).join(", ")}
                            </span>
                          </p>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={clearFolderSelection}
                            className="shrink-0 rounded-full border border-hairline px-3 py-1 text-[11px] font-semibold text-steel transition-colors hover:border-ink hover:text-ink"
                          >
                            Clear
                          </button>
                        </div>
                        <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-steel">
                          {folderFiles.slice(0, 8).map((f) => (
                            <li key={f.relativePath} className="truncate">
                              {f.relativePath}
                            </li>
                          ))}
                          {folderFiles.length > 8 && (
                            <li className="text-stone">
                              …and {folderFiles.length - 8} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Preview File (optional — any type Drive stores) */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Preview File (optional — any type)
                </label>
                <div className="rounded-2xl border-2 border-dashed border-hairline hover:border-ink/60 bg-fog/50 p-4 transition-colors">
                  <input
                    ref={previewInputRef}
                    type="file"
                    onChange={handlePreviewChange}
                    className="block w-full text-xs text-steel file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-fog file:text-ink hover:file:bg-hairline cursor-pointer"
                  />
                  {previewUrl && (
                    <div className="mt-3 relative aspect-video w-36 overflow-hidden rounded-xl border border-hairline shadow-sm">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewFile(null);
                          if (previewUrl) URL.revokeObjectURL(previewUrl);
                          setPreviewUrl(null);
                          if (previewInputRef.current) previewInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-ink/80 text-white text-[10px] flex items-center justify-center hover:bg-ink"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Live batch progress (foreground mode) */}
              {submitting && batchIds && batchIds.length > 0 && (
                <div className="rounded-2xl border border-hairline-soft bg-fog/50 p-4">
                  <UploadProgressBar
                    segments={batchIds.map((id) => {
                      const job = jobs.find((j) => j.id === id);
                      return {
                        label: job?.label ?? id,
                        doneBytes:
                          job?.status === "done"
                            ? (job?.sizeBytes ?? 0)
                            : (job?.sentBytes ?? 0),
                        totalBytes: job?.sizeBytes ?? 0,
                        failed: job?.status === "error",
                      };
                    })}
                  />
                  <p className="mt-1.5 text-xs text-steel">
                    {savingRecord
                      ? "Files uploaded — saving project…"
                      : "Uploading files to Google Drive…"}
                  </p>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={submitting}
                  className="rounded-full border border-hairline px-5 py-2.5 text-xs font-semibold text-steel hover:text-ink hover:bg-fog transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50 transition-colors"
                >
                  {submitting ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Uploading to Google Drive...
                    </>
                  ) : (
                    <>
                      <CheckIcon className="h-4 w-4" />
                      Publish to Drive
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── File Browser Modal (previews + downloads) ── */}
      {browsingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-auto rounded-3xl border border-hairline bg-canvas shadow-2xl animate-scale-up">
            <FileBrowser
              projectId={browsingProject.id}
              projectDriveId={browsingProject.codebaseDriveId}
              projectName={browsingProject.title}
              onClose={() => setBrowsingProject(null)}
            />
          </div>
        </div>
      )}

      {/* ── Image Lightbox Modal ── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-md animate-fade-in cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl border border-white/20 bg-ink shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 bg-black/40 text-white">
              <p className="font-display font-bold text-sm truncate">
                {lightboxImage.title}
              </p>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="grid h-7 w-7 place-items-center rounded-full bg-white/20 hover:bg-white/30 text-white text-xs"
              >
                ✕
              </button>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.title}
              className="max-h-[80vh] w-auto object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
