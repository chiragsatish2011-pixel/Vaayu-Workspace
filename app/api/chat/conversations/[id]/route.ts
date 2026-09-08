import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { getConversationDetail } from "@/lib/chat-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/chat/conversations/:id — single conversation detail.
 * Participant-only (403 for non-participants, even with a guessed ID).
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  try {
    const detail = await getConversationDetail(conversationId, user.id);
    if (!detail) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    return NextResponse.json({ conversation: detail });
  } catch (err) {
    console.error("[GET /api/chat/conversations/:id]", err);
    return NextResponse.json({ error: "Failed to load conversation." }, { status: 500 });
  }
}
