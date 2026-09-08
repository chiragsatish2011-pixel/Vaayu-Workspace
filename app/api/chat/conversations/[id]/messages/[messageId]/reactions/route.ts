import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, messageReactions } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { publishToConversation } from "@/lib/chat-bus";
import { ensureReactionsTable, summarizeReactions } from "@/lib/chat-reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; messageId: string }>;
}

const ALLOWED = ["❤️", "👍", "👎", "😂", "😮", "😢", "🙏", "👏", "🔥", "🎉"];

/**
 * POST /api/chat/conversations/:id/messages/:messageId/reactions { emoji }
 * Toggles the caller's reaction. Same emoji twice removes it; a different
 * emoji replaces it (one reaction per user per message).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId, messageId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { emoji } = body as { emoji?: unknown };
  if (typeof emoji !== "string" || !ALLOWED.includes(emoji)) {
    return NextResponse.json({ error: "Pick an emoji from the reaction set." }, { status: 400 });
  }

  try {
    await ensureReactionsTable();

    const hit = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)))
      .limit(1);
    if (!hit[0]) return NextResponse.json({ error: "Message not found." }, { status: 404 });

    const existing = await db
      .select({ emoji: messageReactions.emoji })
      .from(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, user.id)))
      .limit(1);

    let action: "added" | "removed" | "changed";
    if (existing[0]?.emoji === emoji) {
      await db
        .delete(messageReactions)
        .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, user.id)));
      action = "removed";
    } else if (existing[0]) {
      await db
        .update(messageReactions)
        .set({ emoji })
        .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, user.id)));
      action = "changed";
    } else {
      await db.insert(messageReactions).values({ messageId, userId: user.id, emoji });
      action = "added";
    }

    const rows = await db
      .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji, userId: messageReactions.userId })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, messageId));
    const summary = summarizeReactions(rows, user.id)[messageId] ?? [];

    publishToConversation(conversationId, { type: "message.reacted", data: { messageId, reactions: summary } });
    return NextResponse.json({ action, reactions: summary });
  } catch (err) {
    console.error("[POST /api/chat/.../reactions]", err);
    return NextResponse.json({ error: "Failed to react." }, { status: 500 });
  }
}
