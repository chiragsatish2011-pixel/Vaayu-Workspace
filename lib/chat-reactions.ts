import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Self-healing: the message_reactions table is created on first use
 * (idempotent), so no manual migration step is needed on any environment.
 * Fresh setups also get it via drizzle/0011 + the setup wizard bootstrap.
 */
export async function ensureReactionsTable(): Promise<void> {
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL REFERENCES "public"."chat_messages"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`));
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_user_unique" ON "message_reactions" ("message_id", "user_id")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions" ("message_id")`
    )
  );
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
  mine: boolean;
}

export function summarizeReactions(
  rows: Array<{ messageId: string; emoji: string; userId: string }>,
  selfId: string
): Record<string, ReactionSummary[]> {
  const byMessage = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (!r.messageId || !r.emoji || !r.userId) continue;
    let byEmoji = byMessage.get(r.messageId);
    if (!byEmoji) {
      byEmoji = new Map();
      byMessage.set(r.messageId, byEmoji);
    }
    let users = byEmoji.get(r.emoji);
    if (!users) {
      users = new Set();
      byEmoji.set(r.emoji, users);
    }
    users.add(r.userId);
  }
  const out: Record<string, ReactionSummary[]> = {};
  for (const [messageId, byEmoji] of byMessage) {
    out[messageId] = [...byEmoji.entries()].map(([emoji, users]) => ({
      emoji,
      count: users.size,
      userIds: [...users],
      mine: users.has(selfId),
    }));
  }
  return out;
}
