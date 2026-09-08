import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversationParticipants, conversations, users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import {
  grantConversationToUser,
  publishToConversation,
  publishToUser,
  revokeConversation,
} from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function loadConvo(conversationId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * POST /api/chat/conversations/:id/members { userIds: string[] }
 * Any member may add others (default rule). Adds are ignored for existing
 * members. Direct chats reject adds (exactly 2 people by definition).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { userIds } = body as { userIds?: unknown };
  if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "userIds must be string[]." }, { status: 400 });
  }

  try {
    const conv = await loadConvo(conversationId);
    if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (conv.type === "direct") {
      return NextResponse.json({ error: "Direct chats are exactly 2 people — start a group instead." }, { status: 400 });
    }

    const wanted = [...new Set((userIds as string[]).filter((id) => id))].slice(0, 100);
    if (wanted.length === 0) return NextResponse.json({ error: "No people to add." }, { status: 400 });

    const existing = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    const existingIds = new Set(existing.map((e) => e.userId));
    const fresh = wanted.filter((id) => !existingIds.has(id));
    if (fresh.length === 0) return NextResponse.json({ added: [] });

    const real = await db.select({ id: users.id }).from(users).where(inArray(users.id, fresh));
    if (real.length !== fresh.length) {
      return NextResponse.json({ error: "One or more people were not found." }, { status: 400 });
    }

    await db.insert(conversationParticipants).values(
      fresh.map((id) => ({ conversationId, userId: id }))
    );

    for (const pid of fresh) {
      grantConversationToUser(pid, conversationId);
      publishToUser(pid, { type: "conversation.created", conversationId, data: { conversationId } });
    }
    publishToConversation(conversationId, { type: "members.added", data: { userIds: fresh, addedBy: user.id } });

    return NextResponse.json({ added: fresh }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/chat/conversations/:id/members]", err);
    return NextResponse.json({ error: "Failed to add members." }, { status: 500 });
  }
}

/**
 * DELETE /api/chat/conversations/:id/members { userId }
 * Any member may remove another member from a GROUP (default rule).
 * Removing yourself == leave (also available via /leave). Direct chats
 * reject removals. Removing the last member deletes the conversation.
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { userId: targetId } = body as { userId?: unknown };
  if (typeof targetId !== "string" || !targetId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  try {
    const conv = await loadConvo(conversationId);
    if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (conv.type === "direct") {
      return NextResponse.json({ error: "Direct chats cannot remove members." }, { status: 400 });
    }
    if (targetId === user.id) {
      return NextResponse.json({ error: "Use /leave to leave a group." }, { status: 400 });
    }

    await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, targetId)
        )
      );

    revokeConversation(conversationId);
    // Re-grant remaining members (revoke wiped everyone; streams re-sync on next connect anyway).
    const remaining = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    for (const r of remaining) grantConversationToUser(r.userId, conversationId);

    publishToUser(targetId, { type: "conversation.deleted", conversationId, data: { conversationId, reason: "removed" } });
    if (remaining.length === 0) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      return NextResponse.json({ removed: targetId, conversationDeleted: true });
    }
    publishToConversation(conversationId, { type: "members.removed", data: { userIds: [targetId], removedBy: user.id } });
    return NextResponse.json({ removed: targetId });
  } catch (err) {
    console.error("[DELETE /api/chat/conversations/:id/members]", err);
    return NextResponse.json({ error: "Failed to remove member." }, { status: 500 });
  }
}
