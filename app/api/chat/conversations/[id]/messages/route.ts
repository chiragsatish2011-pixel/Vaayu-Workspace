import { and, desc, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, conversations, users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { isParticipant } from "@/lib/chat-access";
import { publishToConversation } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function enrichedMessage(row: {
  id: string;
  conversationId: string | null;
  content: string;
  contentJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName: string | null;
  avatarDriveId: string | null;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * GET /api/chat/conversations/:id/messages?limit=&before=
 * Participant-only. `before` is an ISO timestamp cursor for paging up.
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  // HARD CHECK: non-participants get 403 even with a guessed ID.
  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw ? new Date(beforeRaw) : null;
    if (beforeRaw && Number.isNaN(before!.getTime())) {
      return NextResponse.json({ error: "Invalid before cursor." }, { status: 400 });
    }

    const conditions = [eq(chatMessages.conversationId, conversationId)];
    if (before) {
      conditions.push(lt(chatMessages.createdAt, before));
    }

    const rows = await db
      .select({
        id: chatMessages.id,
        conversationId: chatMessages.conversationId,
        content: chatMessages.content,
        contentJson: chatMessages.contentJson,
        createdAt: chatMessages.createdAt,
        updatedAt: chatMessages.updatedAt,
        userId: chatMessages.userId,
        userEmail: users.email,
        userRole: users.role,
        displayName: users.displayName,
        avatarDriveId: users.avatarDriveId,
      })
      .from(chatMessages)
      .innerJoin(users, eq(chatMessages.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);

    const messages = rows.map(enrichedMessage).reverse(); // oldest first
    return NextResponse.json({ messages, hasMore: rows.length === limit });
  } catch (err) {
    console.error("[GET /api/chat/conversations/:id/messages]", err);
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: 500 });
  }
}

/**
 * POST /api/chat/conversations/:id/messages { content, contentJson? }
 * Participant-only. Publishes a push event to the conversation's stream —
 * other participants receive it instantly with zero polling.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: conversationId } = await ctx.params;

  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ error: "Not a participant in this conversation." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { content, contentJson } = body as { content?: unknown; contentJson?: unknown };

  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return NextResponse.json({ error: "Message content is required." }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ error: "Message too long (max 5000)." }, { status: 400 });

  let jsonStr: string | null = null;
  if (contentJson !== undefined && contentJson !== null) {
    if (typeof contentJson === "string") {
      jsonStr = contentJson;
      try {
        JSON.parse(jsonStr);
      } catch {
        return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
      }
      if (jsonStr.length > 20000) return NextResponse.json({ error: "contentJson too large." }, { status: 400 });
    } else if (typeof contentJson === "object") {
      try {
        jsonStr = JSON.stringify(contentJson);
      } catch {
        return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
      }
    }
  }

  try {
    const [inserted] = await db
      .insert(chatMessages)
      .values({ conversationId, userId: user.id, content: text, contentJson: jsonStr })
      .returning();

    // Bump recency so the sidebar sorts by latest activity.
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    const message = {
      id: inserted.id,
      conversationId,
      content: inserted.content,
      contentJson: inserted.contentJson,
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      displayName: user.displayName ?? null,
      avatarDriveId: user.avatarDriveId ?? null,
    };

    // Real-time push (replaces the old 2.5s polling).
    publishToConversation(conversationId, { type: "message.created", data: { message } });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/chat/conversations/:id/messages]", err);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }
}
