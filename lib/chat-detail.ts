import { and, desc, eq, gt, ne } from "drizzle-orm";
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
