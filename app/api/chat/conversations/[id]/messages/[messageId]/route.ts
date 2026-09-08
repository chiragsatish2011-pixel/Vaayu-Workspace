import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { publishToConversation } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; messageId: string }>;
}

async function enrichedMessage(messageId: string) {
  const rows = await db
    .select({
      id: chatMessages.id,
      conversationId: chatMessages.conversationId,
      content: chatMessages.content,
      contentJson: chatMessages.contentJson,
      createdAt: chatMessages.createdAt,
      updatedAt: chatMessages.updatedAt,
      userId: chatMessages.userId,
      userEmail: users.email,
      userRole: users.role,
      displayName: users.displayName,
      avatarDriveId: users.avatarDriveId,
    })
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.userId, users.id))
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function ownedMessage(conversationId: string, messageId: string) {
  const rows = await db
    .select({ id: chatMessages.id, userId: chatMessages.userId })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * PATCH /api/chat/conversations/:id/messages/:messageId { content, contentJson? }
 * Author-only. Edits text in place; updatedAt moves so clients show "edited".
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId, messageId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }
  const hit = await ownedMessage(conversationId, messageId);
  if (!hit) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (hit.userId !== user.id) {
    return NextResponse.json({ error: "Only the author can edit this message." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { content, contentJson } = body as { content?: unknown; contentJson?: unknown };
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return NextResponse.json({ error: "Message content is required." }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ error: "Message too long (max 5000)." }, { status: 400 });

  let jsonStr: string | null = null;
  if (contentJson !== undefined && contentJson !== null) {
    if (typeof contentJson === "string") {
      jsonStr = contentJson;
      try {
        JSON.parse(jsonStr);
      } catch {
        return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
      }
      if (jsonStr.length > 20000) return NextResponse.json({ error: "contentJson too large." }, { status: 400 });
    } else if (typeof contentJson === "object") {
      try {
        jsonStr = JSON.stringify(contentJson);
      } catch {
        return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
      }
    }
  }

  try {
    await db
      .update(chatMessages)
      .set({ content: text, contentJson: jsonStr, updatedAt: new Date() })
      .where(eq(chatMessages.id, messageId));
    const message = await enrichedMessage(messageId);
    publishToConversation(conversationId, { type: "message.updated", data: { message } });
    return NextResponse.json({ message });
  } catch (err) {
    console.error("[PATCH /api/chat/.../messages/:messageId]", err);
    return NextResponse.json({ error: "Failed to edit message." }, { status: 500 });
  }
}

/**
 * DELETE /api/chat/conversations/:id/messages/:messageId
 * Author-or-admin. Tombstones in place (keeps ordering + replies intact).
 */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId, messageId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }
  const hit = await ownedMessage(conversationId, messageId);
  if (!hit) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (hit.userId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "Only the author or an admin can delete this message." }, { status: 403 });
  }

  try {
    await db
      .update(chatMessages)
      .set({ content: "🚫 This message was deleted", contentJson: JSON.stringify({ deleted: true }), updatedAt: new Date() })
      .where(eq(chatMessages.id, messageId));
    const message = await enrichedMessage(messageId);
    publishToConversation(conversationId, { type: "message.deleted", data: { message } });
    return NextResponse.json({ message });
  } catch (err) {
    console.error("[DELETE /api/chat/.../messages/:messageId]", err);
    return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });
  }
}
