import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, messageReactions } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { ensureReactionsTable, summarizeReactions } from "@/lib/chat-reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/chat/conversations/:id/messages/reactions
 * All reactions for the conversation in one round trip:
 * { reactions: { [messageId]: [{ emoji, count, userIds, mine }] } }.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  try {
    await ensureReactionsTable();

    const rows = await db
      .select({
        messageId: messageReactions.messageId,
        emoji: messageReactions.emoji,
        userId: messageReactions.userId,
      })
      .from(messageReactions)
      .innerJoin(chatMessages, eq(messageReactions.messageId, chatMessages.id))
      .where(eq(chatMessages.conversationId, conversationId));

    return NextResponse.json({ reactions: summarizeReactions(rows, user.id) });
  } catch (err) {
    console.error("[GET /api/chat/.../messages/reactions]", err);
    return NextResponse.json({ error: "Failed to load reactions." }, { status: 500 });
  }
}
