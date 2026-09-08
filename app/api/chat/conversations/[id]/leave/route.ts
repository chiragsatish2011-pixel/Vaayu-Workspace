import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversationParticipants, conversations } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { publishToConversation, publishToUser, revokeConversation, grantConversationToUser } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/chat/conversations/:id/leave — leave a GROUP.
 * Direct chats cannot be left (matches WhatsApp: DMs just exist).
 * Leaving the last seat deletes the group (messages cascade).
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  try {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (conv.type === "direct") {
      return NextResponse.json({ error: "Direct chats cannot be left." }, { status: 400 });
    }

    await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, user.id)
        )
      );

    revokeConversation(conversationId);
    const remaining = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    for (const r of remaining) {
      grantConversationToUser(r.userId, conversationId);
    }

    publishToUser(user.id, { type: "conversation.deleted", conversationId, data: { conversationId, reason: "left" } });
    if (remaining.length === 0) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      return NextResponse.json({ left: true, conversationDeleted: true });
    }
    publishToConversation(conversationId, { type: "members.removed", data: { userIds: [user.id], removedBy: user.id } });
    return NextResponse.json({ left: true });
  } catch (err) {
    console.error("[POST /api/chat/conversations/:id/leave]", err);
    return NextResponse.json({ error: "Failed to leave conversation." }, { status: 500 });
  }
}
