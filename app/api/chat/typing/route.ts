import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { publishToConversation } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat/typing { conversationId, typing: boolean }
 * Ephemeral typing indicator — NOT persisted. Participant-only; fanned out
 * as a push event on the conversation's stream. Clients expire the
 * indicator locally (~3s) so a dropped "stopped" event can't stick.
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
  const { conversationId, typing } = body as { conversationId?: unknown; typing?: unknown };
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }
  if (typeof typing !== "boolean") {
    return NextResponse.json({ error: "typing must be boolean." }, { status: 400 });
  }

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  publishToConversation(conversationId, {
    type: "typing",
    data: {
      userId: user.id,
      displayName: user.displayName ?? user.email,
      typing,
      at: new Date().toISOString(),
    },
  });
  return NextResponse.json({ ok: true });
}
