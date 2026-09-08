import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  conversationParticipants,
  conversations,
  users,
} from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { getConversationDetail, getConversationDetailsBatch } from "@/lib/chat-detail";
import { grantConversationToUser, publishToUser } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat/conversations — the user's "chats" sidebar.
 * Scoped at the query level: only conversations where the requester is a
 * participant (WHERE via conversation_participants). Sorted by most recent
 * activity, each with last-message preview + unread badge count.
 */
export async function GET() {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 1. My memberships only — this WHERE is the access control.
    const mine = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, user.id));
    if (mine.length === 0) return NextResponse.json({ conversations: [] });

    const ids = mine.map((m) => m.conversationId);

    // 2. Conversations, most recently active first.
    const convRows = await db
      .select()
      .from(conversations)
      .where(inArray(conversations.id, ids))
      .orderBy(desc(conversations.updatedAt));

    // 3. Detail per conversation (members, last message, unread) — batched to avoid N×5 Neon fetches.
    const idsOrdered = convRows.map((c) => c.id);
    const details = await getConversationDetailsBatch(idsOrdered, user.id);

    return NextResponse.json({
      conversations: details,
    });
  } catch (err) {
    console.error("[GET /api/chat/conversations]", err);
    return NextResponse.json({ error: "Failed to load conversations." }, { status: 500 });
  }
}

/**
 * POST /api/chat/conversations — start a DM or create a group.
 * Body: { type: "direct" | "group", name?: string, participantIds: string[] }
 * - direct: participantIds must be exactly ONE other user. If a direct
 *   conversation between these two already exists it is REUSED (no dupes).
 * - group: name required, 1+ other participants. Creator is added + admin
 *   by construction (createdBy). Any member may add later members.
 */
export async function POST(req: Request) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { type, name, participantIds } = body as {
    type?: unknown;
    name?: unknown;
    participantIds?: unknown;
  };

  if (type !== "direct" && type !== "group") {
    return NextResponse.json({ error: "type must be 'direct' or 'group'." }, { status: 400 });
  }
  if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "participantIds must be string[]." }, { status: 400 });
  }
  // Never allow self-insert tricks or dupes; self is always added server-side.
  const others = [...new Set(participantIds.filter((id) => id !== user.id))];
  if (others.length === 0) {
    return NextResponse.json({ error: "Pick at least one other person." }, { status: 400 });
  }
  if (type === "direct" && others.length !== 1) {
    return NextResponse.json({ error: "Direct chats are exactly 2 people." }, { status: 400 });
  }
  if (others.length > 100) {
    return NextResponse.json({ error: "Too many participants (max 100)." }, { status: 400 });
  }

  let groupName: string | null = null;
  if (type === "group") {
    groupName = typeof name === "string" ? name.trim() : "";
    if (!groupName) return NextResponse.json({ error: "Group name is required." }, { status: 400 });
    if (groupName.length > 80) return NextResponse.json({ error: "Group name too long (max 80)." }, { status: 400 });
  }

  try {
    // All participant IDs must be real users (prevents junk rows).
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, others));
    if (userRows.length !== others.length) {
      return NextResponse.json({ error: "One or more people were not found." }, { status: 400 });
    }

    // DM dedupe: reuse the existing direct conversation between this exact pair.
    if (type === "direct") {
      const otherId = others[0];
      const myDirects = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(
          and(
            eq(conversationParticipants.userId, user.id),
            eq(conversations.type, "direct")
          )
        );
      if (myDirects.length > 0) {
        const candidateIds = myDirects.map((d) => d.conversationId);
        const parts = await db
          .select({
            conversationId: conversationParticipants.conversationId,
            userId: conversationParticipants.userId,
          })
          .from(conversationParticipants)
          .where(inArray(conversationParticipants.conversationId, candidateIds));
        const byConvo = new Map<string, string[]>();
        for (const p of parts) {
          const arr = byConvo.get(p.conversationId) ?? [];
          arr.push(p.userId);
          byConvo.set(p.conversationId, arr);
        }
        for (const [cid, memberIds] of byConvo) {
          const set = new Set(memberIds);
          if (set.size === 2 && set.has(user.id) && set.has(otherId)) {
            const detail = await getConversationDetail(cid, user.id);
            return NextResponse.json({ conversation: detail, reused: true }, { status: 200 });
          }
        }
      }
    }

    const [conv] = await db
      .insert(conversations)
      .values({
        type,
        name: groupName,
        createdBy: user.id,
      })
      .returning();

    await db.insert(conversationParticipants).values([
      { conversationId: conv.id, userId: user.id },
      ...others.map((id) => ({ conversationId: conv.id, userId: id })),
    ]);

    // Wake up live streams: grant + notify every participant.
    const allIds = [user.id, ...others];
    for (const pid of allIds) grantConversationToUser(pid, conv.id);
    const detail = await getConversationDetail(conv.id, user.id);
    for (const pid of others) {
      publishToUser(pid, { type: "conversation.created", conversationId: conv.id, data: { conversationId: conv.id } });
    }

    return NextResponse.json({ conversation: detail, reused: false }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/chat/conversations]", err);
    return NextResponse.json({ error: "Failed to create conversation." }, { status: 500 });
  }
}
