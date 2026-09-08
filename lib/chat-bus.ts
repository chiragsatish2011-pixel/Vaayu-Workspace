/**
 * In-memory push bus for Chat SSE delivery.
 *
 * Each connected client registers once (via /api/chat/stream) with the set
 * of conversation IDs it may see — a snapshot of conversation_participants
 * taken at connect time, AFTER session auth. publish() only fans out to
 * connections whose snapshot contains the conversation, so a channel name
 * can never leak a conversation to a non-participant.
 *
 * Notes / limits (stated honestly, not hidden):
 * - Single-process: works on local dev and single-instance deploys. If the
 *   app ever scales to N server instances, this must be backed by Redis /
 *   Pusher / Ably — POST and GET may land on different instances and the
 *   event would not cross over. The API contract (event shapes, SSE URL)
 *   is designed so that swap is server-only, no client change needed.
 * - No Pusher/Ably was ever wired in (confirmed: package.json has neither
 *   dep, chat used setInterval polling). This bus replaces polling with
 *   genuine server push and zero new dependencies.
 */

export type ChatPushEventType =
  | "message.created"
  | "members.added"
  | "members.removed"
  | "conversation.created"
  | "conversation.deleted"
  | "typing";

export interface ChatPushEvent {
  type: ChatPushEventType;
  /** Null for user-targeted control events (e.g. conversation.created). */
  conversationId: string | null;
  data: unknown;
}

interface Conn {
  userId: string;
  conversations: Set<string>;
  send: (event: ChatPushEvent) => void;
}

const conns = new Set<Conn>();

/** Register a stream connection. Returns an unsubscribe function. */
export function addConnection(conn: Conn): () => void {
  conns.add(conn);
  return () => {
    conns.delete(conn);
  };
}

/** Push an event to every connected participant of a conversation. */
export function publishToConversation(conversationId: string, event: Omit<ChatPushEvent, "conversationId"> & { conversationId?: string }): void {
  const full: ChatPushEvent = { ...event, conversationId };
  for (const c of conns) {
    if (!c.conversations.has(conversationId)) continue;
    try {
      c.send(full);
    } catch {
      // Dead connection — stream cleanup removes it on cancel.
    }
  }
}

/** Push a control event to all connections of one user (any conversation). */
export function publishToUser(userId: string, event: ChatPushEvent): void {
  for (const c of conns) {
    if (c.userId !== userId) continue;
    try {
      c.send(event);
    } catch {
      // ignore dead connections
    }
  }
}

/** Grant a freshly-created conversation to a user's live connections. */
export function grantConversationToUser(userId: string, conversationId: string): void {
  for (const c of conns) {
    if (c.userId === userId) c.conversations.add(conversationId);
  }
}

/** Revoke a conversation from everywhere (member removed / convo deleted). */
export function revokeConversation(conversationId: string, exceptUserId?: string): void {
  for (const c of conns) {
    if (exceptUserId && c.userId === exceptUserId) continue;
    c.conversations.delete(conversationId);
  }
}

/** For diagnostics: how many live streams are connected. */
export function connectionCount(): number {
  return conns.size;
}
