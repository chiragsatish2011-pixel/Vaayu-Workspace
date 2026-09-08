import "server-only";

import { NextResponse } from "next/server";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { archiveMessages, ensureChatArchiveSheet } from "@/lib/chat-archive-store";
import type { ChatArchiveRecord } from "@/lib/chat-archive-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat/archive — archive messages older than 24h from Neon to Sheets.
 * Keeps Neon free. Idempotent — dedupes by id via sheet cache.
 * Admin-only for manual trigger; cron will also call with internal secret if needed.
 */
export async function POST(req: Request) {
  // Allow Vercel Cron via Authorization header (Vercel sends Bearer <CRON_SECRET> when cron) as well as admin session
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const isCron = (cronSecret && auth === `Bearer ${cronSecret}`) || isVercelCron;
  if (!isCron) {
    const user = await requireApiSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  try {
    await ensureChatArchiveSheet();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
      .limit(500);

    if (oldRows.length === 0) {
      return NextResponse.json({ archived: 0, message: "No messages older than 24h to archive." });
    }

    const records: ChatArchiveRecord[] = oldRows
      .filter((r) => r.conversationId) // skip legacy null conversationId
      .map((r) => ({
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
        archivedAt: new Date().toISOString(),
      }));

    await archiveMessages(records);

    // Delete from Neon only after successful Sheets append
    const idsToDelete = records.map((r) => r.id);
    for (const id of idsToDelete) {
      await db.delete(chatMessages).where(eq(chatMessages.id, id));
    }

    return NextResponse.json({ archived: records.length, message: `Archived ${records.length} messages to Sheets and freed Neon.` });
  } catch (err) {
    console.error("[POST /api/chat/archive]", err);
    return NextResponse.json({ error: "Archive failed. Check Sheets setup and Neon." }, { status: 500 });
  }
}

export async function GET() {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ status: "Chat archive is Sheets-backed. POST to archive >24h messages." });
}
