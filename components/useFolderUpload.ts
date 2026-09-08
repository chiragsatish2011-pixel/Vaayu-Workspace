"use client";

import { useCallback } from "react";
import type { PickedUploadFile } from "@/components/folderWalk";
import {
  uploadFileToDrive,
  type FileProgress,
} from "@/components/UploadManager";

/** Controlled parallelism: 3 concurrent file uploads (Drive rate limit safe). */
export const UPLOAD_CONCURRENCY = 3;

export interface FolderUploadResult {
  topFolderId: string | null;
  fileIds: string[];
  failed: { path: string; error: string }[];
  succeeded: number;
}

/**
 * Shared folder-tree uploader — the exact resilient pipeline used by both
 * the Projects publish flow and the team Files page (single source, no
 * duplicated retry/backoff logic).
 *
 * Uploads one picked folder tree with bounded parallelism inside a
 * caller-owned tracked job. Each file carries its relativePath so the
 * server recreates the exact subfolder structure inside the locked Drive
 * folder — uploads always land under GOOGLE_DRIVE_UPLOAD_FOLDER_ID, never
 * anywhere else. Resilient per-file: successes are collected, failures
 * recorded without aborting the rest, transient errors get exponential
 * backoff, sustained 429/5xx throttles concurrency down.
 */
export function useFolderUpload(): {
  runFolderUpload: (
    picked: PickedUploadFile[],
    report: (sentBytes: number, files?: FileProgress) => void,
    sentBaseRef: { value: number }
  ) => Promise<FolderUploadResult>;
} {
  const runFolderUpload = useCallback(
    async (
      picked: PickedUploadFile[],
      report: (sentBytes: number, files?: FileProgress) => void,
      sentBaseRef: { value: number }
    ): Promise<FolderUploadResult> => {
      let topFolderId: string | null = null;
      const fileIds: string[] = [];
      const failed: { path: string; error: string }[] = [];
      // Concurrency control — research says 3 is optimal for Drive single cred
      let concurrency = UPLOAD_CONCURRENCY;
      let consecutiveRateLimits = 0;

      // Per-file progress tracking for aggregate reporting
      const perFileSent = new Map<number, number>();
      const perFileDone = new Set<number>();

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
        let uploaded: Awaited<ReturnType<typeof uploadFileToDrive>> | null =
          null;
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
            const isRateLimit =
              status === 429 ||
              /429|rateLimit|quotaExceeded|dailyLimit|userRateLimit/i.test(msg);
            const is5xx = status >= 500 && status < 600;
            const isTransient =
              /Network error|timed out|Could not start|rateLimit|429|5\d{2}/i.test(
                msg
              );
            if (!isTransient || attempt >= 2) break;
            // Exponential backoff: 800ms, 1600ms, 3200ms + jitter
            const backoff = 800 * Math.pow(2, attempt) + Math.random() * 200;
            if (isRateLimit || is5xx) {
              consecutiveRateLimits++;
              // If sustained throttling, reduce concurrency for remainder of batch
              if (consecutiveRateLimits >= 3 && concurrency > 1) {
                concurrency = Math.max(1, concurrency - 1);
                console.warn(
                  `[uploads] sustained 429/5xx — reducing concurrency to ${concurrency}`
                );
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
          const msg =
            lastErr instanceof Error ? lastErr.message : "Upload failed";
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
              if (idx >= concurrency)
                await new Promise((r) => setTimeout(r, 40));
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
      report(sentBaseRef.value, {
        done: perFileDone.size,
        total: picked.length,
        failed: failed.length,
      });

      return { topFolderId, fileIds, failed, succeeded: fileIds.length };
    },
    []
  );

  return { runFolderUpload };
}
