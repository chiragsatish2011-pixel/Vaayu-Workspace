import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chatMessages,
  conversationParticipants,
  conversations,
  users,
} from "@/db/schema";
import { getMembership } from "@/lib/chat-access";

export interface ConversationMember {
  userId: string;
  email: string;
  displayName: string | null;
  avatarDriveId: string | null;
  joinedAt: string;
  lastReadAt: string | null;
}

export interface ConversationDetail {
  id: string;
  type: "direct" | "group";
  name: string | null;
  createdAt: string;
  updatedAt: string;
  members: ConversationMember[];
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    userId: string;
    userEmail: string;
    displayName: string | null;
  } | null;
  unreadCount: number;
}

/**
 * Full detail for ONE conversation the viewer is known to participate in.
 * Callers MUST verify participation first (via lib/chat-access) — this
 * function does not re-check, so list/create/get stay consistent.
 */
export async function getConversationDetail(
  conversationId: string,
  viewerId: string
): Promise<ConversationDetail | null> {
  const convRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return null;

  const membership = await getMembership(conversationId, viewerId);
  const lastReadAt = membership?.lastReadAt ?? null;

  const memberRows = await db
    .select({
      userId: conversationParticipants.userId,
      email: users.email,
      displayName: users.displayName,
      avatarDriveId: users.avatarDriveId,
      joinedAt: conversationParticipants.joinedAt,
      lastReadAt: conversationParticipants.lastReadAt,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(conversationParticipants.userId, users.id))
    .where(eq(conversationParticipants.conversationId, conversationId));

  const lastRows = await db
    .select({
      id: chatMessages.id,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      userId: chatMessages.userId,
      userEmail: users.email,
      displayName: users.displayName,
    })
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.userId, users.id))
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  let unreadCount = 0;
  if (lastReadAt) {
    const unreadRows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          gt(chatMessages.createdAt, lastReadAt),
          ne(chatMessages.userId, viewerId)
        )
      )
      .limit(500);
    unreadCount = unreadRows.length;
  } else {
    // Never read: everything from others counts (capped at 500 query).
    const unreadRows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          ne(chatMessages.userId, viewerId)
        )
      )
      .limit(500);
    unreadCount = unreadRows.length;
  }

  const last = lastRows[0];
  return {
    id: conv.id,
    type: conv.type,
    name: conv.name,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    members: memberRows.map((m) => ({
      userId: m.userId,
      email: m.email,
      displayName: m.displayName,
      avatarDriveId: m.avatarDriveId,
      joinedAt: m.joinedAt.toISOString(),
      lastReadAt: m.lastReadAt ? (m.lastReadAt as Date).toISOString() : null,
    })),
    lastMessage: last
      ? {
          id: last.id,
          content: last.content,
          createdAt: last.createdAt.toISOString(),
          userId: last.userId,
          userEmail: last.userEmail,
          displayName: last.displayName,
        }
      : null,
    unreadCount,
  };
}

/**
 * Batched detail for MANY conversations — replaces N×5 queries with ~4 queries.
 * Used by GET /api/chat/conversations sidebar to avoid 100+ Neon fetches.
 */
export async function getConversationDetailsBatch(
  conversationIds: string[],
  viewerId: string
): Promise<ConversationDetail[]> {
  if (conversationIds.length === 0) return [];
  // 1. Conversations
  const convRows = await db.select().from(conversations).where(inArray(conversations.id, conversationIds));
  const convById = new Map(convRows.map((c) => [c.id, c]));

  // 2. Memberships (lastReadAt per convo for viewer)
  const membershipRows = await db
    .select({ conversationId: conversationParticipants.conversationId, lastReadAt: conversationParticipants.lastReadAt })
    .from(conversationParticipants)
    .where(and(inArray(conversationParticipants.conversationId, conversationIds), eq(conversationParticipants.userId, viewerId)));
  const lastReadById = new Map(membershipRows.map((r) => [r.conversationId, r.lastReadAt]));

  // 3. All members for these conversations
  const memberRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      userId: conversationParticipants.userId,
      email: users.email,
      displayName: users.displayName,
      avatarDriveId: users.avatarDriveId,
      joinedAt: conversationParticipants.joinedAt,
      lastReadAt: conversationParticipants.lastReadAt,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(conversationParticipants.userId, users.id))
    .where(inArray(conversationParticipants.conversationId, conversationIds));
  const membersById = new Map<string, typeof memberRows>();
  for (const r of memberRows) {
    const arr = membersById.get(r.conversationId) ?? [];
    arr.push(r);
    membersById.set(r.conversationId, arr);
  }

  // 4. Last message per conversation — one query via DISTINCT ON (Postgres)
  let lastById = new Map<string, { id: string; content: string; createdAt: Date; userId: string; userEmail: string; displayName: string | null }>();
  try {
    // Use raw SQL for DISTINCT ON — drizzle's inArray helper not needed, ids are UUIDs vetted via membership.
    const placeholders = conversationIds.map((_, i) => `$${i + 1}`).join(", ");
    const result: any = await (db as any).execute(
      sql.raw(
        `SELECT DISTINCT ON (conversation_id) conversation_id, id, content, created_at, user_id FROM chat_messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, created_at DESC`
      )
    );
    const rows: any[] = Array.isArray(result) ? result : (result as any).rows ?? [];
    // Need user info for last message — fetch users for those userIds
    const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
    let userById = new Map<string, { email: string; displayName: string | null }>();
    if (userIds.length > 0) {
      const uRows = await db.select({ id: users.id, email: users.email, displayName: users.displayName }).from(users).where(inArray(users.id, userIds));
      userById = new Map(uRows.map((u) => [u.id, u]));
    }
    for (const r of rows) {
      const u = userById.get(r.user_id);
      lastById.set(r.conversation_id, {
        id: r.id,
        content: r.content,
        createdAt: new Date(r.created_at),
        userId: r.user_id,
        userEmail: u?.email ?? "",
        displayName: u?.displayName ?? null,
      });
    }
  } catch {
    // Fallback: per-conversation last (still better than 5N) — limited to 1 per convo via Promise.all
    const lasts = await Promise.all(
      conversationIds.map(async (cid) => {
        const rows = await db
          .select({ id: chatMessages.id, content: chatMessages.content, createdAt: chatMessages.createdAt, userId: chatMessages.userId, userEmail: users.email, displayName: users.displayName })
          .from(chatMessages)
          .innerJoin(users, eq(chatMessages.userId, users.id))
          .where(eq(chatMessages.conversationId, cid))
          .orderBy(desc(chatMessages.createdAt))
          .limit(1);
        return { cid, row: rows[0] ?? null };
      })
    );
    for (const { cid, row } of lasts) if (row) lastById.set(cid, row as any);
  }

  // 5. Unread counts — single query for all candidate unread messages, then filter per lastReadAt
  const candidateUnread = await db
    .select({ conversationId: chatMessages.conversationId, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(inArray(chatMessages.conversationId, conversationIds), ne(chatMessages.userId, viewerId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(5000);
  const unreadById = new Map<string, number>();
  for (const cid of conversationIds) {
    const lastRead = lastReadById.get(cid) ?? null;
    let cnt = 0;
    for (const m of candidateUnread) {
      if (m.conversationId !== cid) continue;
      if (lastRead && m.createdAt <= lastRead) continue;
      cnt++;
      if (cnt >= 500) break;
    }
    unreadById.set(cid, cnt);
  }

  // Assemble in original order (convRows order = updatedAt desc from caller)
  const out: ConversationDetail[] = [];
  for (const cid of conversationIds) {
    const conv = convById.get(cid);
    if (!conv) continue;
    const members = membersById.get(cid) ?? [];
    const last = lastById.get(cid) ?? null;
    out.push({
      id: conv.id,
      type: conv.type,
      name: conv.name,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      members: members.map((m: any) => ({
        userId: m.userId,
        email: m.email,
        displayName: m.displayName,
        avatarDriveId: m.avatarDriveId,
        joinedAt: m.joinedAt.toISOString(),
        lastReadAt: m.lastReadAt ? (m.lastReadAt as Date).toISOString() : null,
      })),
      lastMessage: last
        ? {
            id: (last as any).id,
            content: (last as any).content,
            createdAt: (last as any).createdAt.toISOString(),
            userId: (last as any).userId,
            userEmail: (last as any).userEmail,
            displayName: (last as any).displayName,
          }
        : null,
      unreadCount: unreadById.get(cid) ?? 0,
    });
  }
  return out;
}
