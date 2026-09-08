"use client";

import { useEffect, useRef, useState } from "react";
import {
  collectFilesFromDrop,
  collectFilesFromInput,
  pickedBatchBytes,
  pickedBatchRoots,
  type PickedUploadFile,
} from "@/components/folderWalk";
import { useFolderUpload } from "@/components/useFolderUpload";
import { useUploads } from "@/components/UploadManager";
import { formatBytes } from "@/components/UploadProgressBar";

/**
 * Team Files uploader — dropzone + file/folder pickers wired to the SAME
 * resilient pipeline as Projects publishing (shared useFolderUpload hook:
 * concurrency, backoff, per-file progress) and the SAME global upload
 * toast. No new upload logic lives here.
 *
 * Differences from Projects publishing (deliberate): no title/description
 * form and no database record — files land directly in the locked team
 * folder (server pins the destination at session-mint time, exactly like
 * Projects). No compression, no type filtering: everything uploads as-is.
 */
export function FilesUploader({ onUploaded }: { onUploaded: () => void }) {
  const [picked, setPicked] = useState<PickedUploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { track } = useUploads();
  const { runFolderUpload } = useFolderUpload();

  // Real folder-select input: React has no webkitdirectory prop, so the
  // attribute is set imperatively (same pattern as Projects publishing).
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const addPicked = (files: PickedUploadFile[]) => {
    if (files.length === 0) return;
    setPicked((prev) => [...prev, ...files]);
    setError(null);
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPicked(collectFilesFromInput(e.target.files));
    if (filesInputRef.current) filesInputRef.current.value = "";
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPicked(collectFilesFromInput(e.target.files));
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    setScanning(true);
    setError(null);
    try {
      // Recursive DataTransferItem walk: a dropped folder resolves to its
      // ENTIRE contents — never a single drilled-down file.
      const files = await collectFilesFromDrop(e.dataTransfer);
      if (files.length === 0) {
        setError("That drop contained no files — try different files or a folder.");
        return;
      }
      addPicked(files);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not read the dropped items."
      );
    } finally {
      setScanning(false);
    }
  };

  const handleUpload = () => {
    if (picked.length === 0 || uploading) return;
    const batch = picked;
    const totalBytes = pickedBatchBytes(batch);
    const label =
      batch.length === 1
        ? `Upload "${batch[0]!.file.name}" to Team Files`
        : `Upload ${batch.length} files to Team Files`;
    setUploading(true);
    setError(null);
    // One globally tracked job → progress survives navigation via the
    // bottom-right toast (UploadProvider lives above every route).
    const { finished } = track(label, totalBytes, async (report, setFinalizing) => {
      const sentBaseRef = { value: 0 };
      const tree = await runFolderUpload(batch, report, sentBaseRef);
      setFinalizing();
      if (tree.succeeded === 0) {
        throw new Error(
          tree.failed[0]?.error || "Upload failed — nothing reached Drive."
        );
      }
      if (tree.failed.length > 0) {
        // Partial success still lands: successes are in Drive, failures
        // stay visible on the toast's failed-file count.
        console.warn(
          `[FilesUploader] partial upload: ${tree.succeeded}/${batch.length} succeeded, ${tree.failed.length} failed.`
        );
      }
    });
    // Clear the staging area right away (uploads continue in the toast);
    // refresh the listing once bytes have landed.
    setPicked([]);
    finished.then(
      () => {
        setUploading(false);
        onUploaded();
      },
      (err: unknown) => {
        setUploading(false);
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    );
  };

  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            Upload files
          </h2>
          <p className="mt-0.5 text-xs text-steel">
            Any type, any size Drive accepts — straight into the team folder.
          </p>
        </div>
        {picked.length > 0 && (
          <button
            type="button"
            onClick={() => setPicked([])}
            disabled={uploading}
            className="shrink-0 rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold text-steel transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`mt-4 rounded-2xl border-2 border-dashed p-4 transition-colors ${
          dragActive
            ? "border-ink bg-fog"
            : "border-hairline hover:border-ink/60 bg-fog/50"
        }`}
      >
        <input
          ref={filesInputRef}
          type="file"
          multiple
          onChange={handleFilesChange}
          className="hidden"
          aria-label="Choose files to upload"
        />
        <input
          ref={folderInputRef}
          type="file"
          onChange={handleFolderChange}
          className="hidden"
          aria-label="Choose a folder to upload"
        />
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <p className="text-sm font-semibold text-ink">
            {scanning ? "Reading dropped items…" : "Drop files or a folder here, or"}
          </p>
          {!scanning && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => filesInputRef.current?.click()}
                className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50 transition-colors"
              >
                Choose files…
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => folderInputRef.current?.click()}
                className="rounded-full border border-hairline bg-canvas px-5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:opacity-50"
              >
                Choose folder…
              </button>
            </div>
          )}
          <p className="max-w-sm text-[11px] leading-relaxed text-stone">
            Picked folders always upload in full — every file, every
            subfolder, every depth level. Nothing is skipped or recompressed.
          </p>
        </div>

        {picked.length > 0 && (
          <div className="mt-3 rounded-xl border border-hairline-soft bg-canvas p-3">
            <p className="text-xs font-mono text-ink">
              <strong>{picked.length}</strong>{" "}
              {picked.length === 1 ? "file" : "files"} ·{" "}
              {formatBytes(pickedBatchBytes(picked))}
              <span className="text-stone">
                {" "}
                — {pickedBatchRoots(picked).join(", ")}
              </span>
            </p>
            <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-steel">
              {picked.slice(0, 8).map((f) => (
                <li key={f.relativePath} className="truncate">
                  {f.relativePath}
                </li>
              ))}
              {picked.length > 8 && (
                <li className="text-stone">…and {picked.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={handleUpload}
          disabled={picked.length === 0 || uploading}
          className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50 transition-colors"
        >
          {uploading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Uploading in background…
            </>
          ) : (
            <>Upload to Team Files</>
          )}
        </button>
      </div>
    </div>
  );
}
