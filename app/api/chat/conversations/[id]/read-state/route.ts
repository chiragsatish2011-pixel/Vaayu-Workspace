import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversationParticipants } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/chat/conversations/:id/read-state — per-member read watermarks.
 * Participant-only. Drives ✓✓ ticks, the "New" divider anchor, and presence-adjacent UI.
 * { watermarks: [{ userId, lastReadAt: ISO | null }] }
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  try {
    const rows = await db
      .select({ userId: conversationParticipants.userId, lastReadAt: conversationParticipants.lastReadAt })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    return NextResponse.json({
      watermarks: rows.map((r) => ({ userId: r.userId, lastReadAt: r.lastReadAt ? r.lastReadAt.toISOString() : null })),
    });
  } catch (err) {
    console.error("[GET /api/chat/conversations/:id/read-state]", err);
    return NextResponse.json({ error: "Failed to load read state." }, { status: 500 });
  }
}
