import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";

/**
 * LEGACY endpoint — the old single global "Team Chat" room.
 *
 * The global room no longer exists. These handlers are kept only so old
 * clients fail LOUDLY (410 Gone) instead of silently reading a shared feed.
 * All chat traffic must go through /api/chat/conversations* which enforce
 * per-conversation participant access control.
 *
 * Scoped equivalents:
 * - GET  /api/chat/conversations (sidebar) + /api/chat/conversations/:id/messages
 * - POST /api/chat/conversations/:id/messages
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Back-compat shim: an old client passing ?conversationId= gets proxied
  // through the SAME participant check as the new routes. No param (the old
  // global-room behavior) is gone.
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json(
      { error: "Gone: the global team room was replaced by private conversations. Use /api/chat/conversations." },
      { status: 410 }
    );
  }
  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }
  const upstream = `/api/chat/conversations/${conversationId}/messages?${new URL(req.url).searchParams.toString()}`;
  return NextResponse.json(
    { error: "Gone: use the scoped endpoint.", use: upstream },
    { status: 410 }
  );
}

export async function POST() {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "Gone: the global team room was replaced by private conversations. POST /api/chat/conversations/:id/messages." },
    { status: 410 }
  );
}
