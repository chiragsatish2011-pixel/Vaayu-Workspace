import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationParticipants } from "@/db/schema";

/**
 * Single choke point for Chat access control.
 *
 * EVERY route that reads or writes messages MUST call requireParticipant()
 * first. Visibility is enforced at the query level (membership row must
 * exist) — never filtered client-side after fetching everything.
 */

export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  if (!conversationId || !userId) return false;
  const rows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** All conversation IDs the user can see (drives the chats sidebar query). */
export async function getUserConversationIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userId));
  return rows.map((r) => r.conversationId);
}

/** Membership row for the user (carries lastReadAt for unread badges). */
export async function getMembership(conversationId: string, userId: string) {
  const rows = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
