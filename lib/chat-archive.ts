import "server-only";

import { asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, users } from "@/db/schema";
import {
  archiveMessages,
  ensureChatArchiveSheet,
  getArchivedIdSet,
} from "@/lib/chat-archive-store";
import type { ChatArchiveRecord } from "@/lib/chat-archive-schema";

export interface ChatArchiveResult {
  /** Rows appended to Sheets in this run. */
  archived: number;
  /** Rows already in Sheets that were only deleted from Neon. */
  alreadyArchived: number;
  /** Batches processed. */
  batches: number;
}

/**
 * Move every chat message older than 24h from Neon to the ChatArchive
 * Google Sheet, then delete the Neon copies to keep database storage free.
 *
 * Safety properties:
 * - Neon deletes happen ONLY after the Sheets append succeeds.
 * - Re-runs are idempotent: ids already in Sheets are skipped for append
 *   but still deleted from Neon (covers a previous crash between the two).
 * - Reactions die with their message via the FK cascade — no orphans, and
 *   no extra Neon rows left behind.
 * - Pre-conversation legacy rows (NULL conversation_id, never served by the
 *   app) are left untouched: they can't be represented in the archive.
 *
 * Shared by the nightly Vercel cron (GET), the admin manual trigger (POST),
 * and the opportunistic background sweep after each sent message.
 */
export async function runChatArchiveJob(opts?: {
  batchSize?: number;
  maxBatches?: number;
}): Promise<ChatArchiveResult> {
  const batchSize = Math.min(Math.max(opts?.batchSize ?? 500, 1), 1000);
  const maxBatches = Math.min(Math.max(opts?.maxBatches ?? 10, 1), 50);
  const result: ChatArchiveResult = { archived: 0, alreadyArchived: 0, batches: 0 };

  await ensureChatArchiveSheet();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (;;) {
    const existing = await getArchivedIdSet();
    const oldRows = await db
      .select({
        id: chatMessages.id,
        conversationId: chatMessages.conversationId,
        userId: chatMessages.userId,
        content: chatMessages.content,
        contentJson: chatMessages.contentJson,
        createdAt: chatMessages.createdAt,
        updatedAt: chatMessages.updatedAt,
        userEmail: users.email,
        userRole: users.role,
        displayName: users.displayName,
        avatarDriveId: users.avatarDriveId,
      })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.userId))
      .where(lt(chatMessages.createdAt, cutoff))
      .orderBy(asc(chatMessages.createdAt))
      .limit(batchSize);

    if (oldRows.length === 0) break;

    const archivable = oldRows.filter((r) => r.conversationId);
    const fresh = archivable.filter((r) => !existing.has(r.id));
    const stale = archivable.filter((r) => existing.has(r.id));

    if (fresh.length > 0) {
      const now = new Date().toISOString();
      const records: ChatArchiveRecord[] = fresh.map((r) => ({
        id: r.id,
        conversationId: r.conversationId!,
        userId: r.userId,
        userEmail: r.userEmail,
        userRole: r.userRole as "admin" | "member",
        displayName: r.displayName,
        avatarDriveId: r.avatarDriveId,
        content: r.content,
        contentJson: r.contentJson,
        createdAt: (r.createdAt as Date).toISOString(),
        updatedAt: (r.updatedAt as Date).toISOString(),
        archivedAt: now,
      }));
      await archiveMessages(records);
      result.archived += records.length;
    }
    result.alreadyArchived += stale.length;

    const idsToDelete = [...fresh.map((r) => r.id), ...stale.map((r) => r.id)];
    if (idsToDelete.length === 0) {
      // Only un-archivable legacy rows remain in range — deleting nothing
      // would loop forever, so stop. (Legacy rows are finite and frozen.)
      break;
    }
    await db.delete(chatMessages).where(inArray(chatMessages.id, idsToDelete));

    result.batches += 1;
    if (oldRows.length < batchSize || result.batches >= maxBatches) break;
  }

  return result;
}
