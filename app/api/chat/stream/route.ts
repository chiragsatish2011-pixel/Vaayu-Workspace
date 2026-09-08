import { getServerSession } from "next-auth";
import { db } from "@/db";
import { conversationParticipants, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authOptions } from "@/lib/auth";
import { addConnection, type ChatPushEvent } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat/stream — single push stream for ALL of the user's
 * conversations (WhatsApp Web holds one socket, not one per chat).
 *
 * Auth: session cookie (EventSource sends cookies). On connect the server
 * snapshots the user's participant conversation IDs from the DB; the bus
 * only delivers events for conversations in that snapshot, so a client can
 * never snoop a conversation it isn't part of by guessing IDs — there is
 * no per-conversation channel name to guess at all.
 *
 * This REPLACES the old 2.5s polling loop. Clients hold this EventSource
 * open and receive message.created / members.* / conversation.* / typing
 * events instantly. A comment heartbeat every 25s keeps proxies alive.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Re-read the user row (deleted accounts lose the stream immediately).
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (userRows.length === 0) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = userRows[0].id;

  const memberships = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userId));
  const allowed = new Set(memberships.map((m) => m.conversationId));

  const encoder = new TextEncoder();
  let send: ((event: ChatPushEvent) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller closed — cleanup happens in cancel().
        }
      };

      send = (event: ChatPushEvent) => {
        write(`event: ${event.type}\ndata: ${JSON.stringify({ conversationId: event.conversationId, ...((event.data as Record<string, unknown>) ?? {}) })}\n\n`);
      };

      unsubscribe = addConnection({ userId, conversations: allowed, send });

      // Initial handshake so the client knows the stream is live.
      write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

      heartbeat = setInterval(() => {
        write(`: heartbeat ${Date.now()}\n\n`);
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      send = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
