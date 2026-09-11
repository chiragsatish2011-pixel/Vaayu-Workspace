import { NextResponse } from "next/server";
import { count, lt } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { runChatArchiveJob } from "@/lib/chat-archive";
import { getAllArchivedCount } from "@/lib/chat-archive-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat archive — messages older than 24h live in the ChatArchive Google
 * Sheet, never in Neon (limited storage). The messages API transparently
 * merges Sheets history with live Neon rows, so archiving is invisible.
 *
 * - GET with cron credentials (Vercel Cron calls this nightly): runs the job.
 * - GET with a user session: read-only status (counts only, archives nothing).
 * - POST with cron credentials or an admin session: runs the job (manual trigger).
 *
 * NOTE: Vercel Cron issues GET requests, so the job MUST live on GET —
 * a POST-only job would make the nightly cron a silent no-op.
 */
function isCronRequest(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    // Strict mode (recommended): Vercel auto-sends `Bearer $CRON_SECRET`.
    return auth === `Bearer ${cronSecret}`;
  }
  // No secret configured (local/dev): accept the platform header, loudly.
  if (req.headers.get("x-vercel-cron") === "1") {
    console.warn(
      "[chat/archive] CRON_SECRET is not set — trusting x-vercel-cron header. Set CRON_SECRET in Vercel for strict cron auth."
    );
    return true;
  }
  return false;
}

async function statusPayload() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[pending], archivedTotal] = await Promise.all([
    db
      .select({ value: count() })
      .from(chatMessages)
      .where(lt(chatMessages.createdAt, cutoff)),
    getAllArchivedCount().catch(() => -1),
  ]);
  return {
    status: "Chat archive is Sheets-backed. Messages older than 24h are moved to Sheets and deleted from Neon.",
    neonOlderThan24h: pending.value,
    sheetsArchivedTotal: archivedTotal,
  };
}

export async function GET(req: Request) {
  if (isCronRequest(req)) {
    try {
      const result = await runChatArchiveJob();
      return NextResponse.json({
        archived: result.archived,
        alreadyArchived: result.alreadyArchived,
        batches: result.batches,
        message: `Archived ${result.archived} messages to Sheets and freed Neon.`,
      });
    } catch (err) {
      console.error("[GET /api/chat/archive]", err);
      return NextResponse.json(
        { error: "Archive failed. Check Sheets setup and Neon." },
        { status: 500 }
      );
    }
  }

  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await statusPayload());
  } catch (err) {
    console.error("[GET /api/chat/archive status]", err);
    return NextResponse.json({ error: "Archive status failed." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isCronRequest(req)) {
    const user = await requireApiSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  try {
    const result = await runChatArchiveJob();
    return NextResponse.json({
      archived: result.archived,
      alreadyArchived: result.alreadyArchived,
      batches: result.batches,
      message: `Archived ${result.archived} messages to Sheets and freed Neon.`,
    });
  } catch (err) {
    console.error("[POST /api/chat/archive]", err);
    return NextResponse.json(
      { error: "Archive failed. Check Sheets setup and Neon." },
      { status: 500 }
    );
  }
}
