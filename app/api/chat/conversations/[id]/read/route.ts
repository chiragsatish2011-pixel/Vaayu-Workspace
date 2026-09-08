import { and, eq } from "drizzle-orm";
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
 * POST /api/chat/conversations/:id/read — move the unread watermark.
 * Body: {} (marks now) or { lastReadAt: ISO }. Participant-only.
 * Drives the unread-count badges in the conversation list.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  let at = new Date();
  try {
    const body = (await req.json().catch(() => null)) as { lastReadAt?: unknown } | null;
    if (body?.lastReadAt) {
      const parsed = new Date(String(body.lastReadAt));
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid lastReadAt." }, { status: 400 });
      }
      // Never move the watermark backwards.
      at = parsed;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const current = await db
      .select({ lastReadAt: conversationParticipants.lastReadAt })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, user.id)
        )
      )
      .limit(1);
    const prev = current[0]?.lastReadAt ?? null;
    const next = !prev || at > prev ? at : prev;

    await db
      .update(conversationParticipants)
      .set({ lastReadAt: next })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, user.id)
        )
      );

    return NextResponse.json({ lastReadAt: next.toISOString() });
  } catch (err) {
    console.error("[POST /api/chat/conversations/:id/read]", err);
    return NextResponse.json({ error: "Failed to mark read." }, { status: 500 });
  }
}
