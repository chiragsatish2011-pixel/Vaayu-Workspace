import { NextRequest, NextResponse } from "next/server";
import { desc, lt } from "drizzle-orm";
import { db } from "@/db";
import { calls } from "@/db/schema";
import { dailyRoomNameFor, dailyRoomProperties, type CallContext, type CallType } from "@/lib/calls";
import { isBuildPhase, requireDailyApiKey } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to delete expired calls (lazy cleanup)
async function pruneExpired() {
  try {
    const now = new Date();
    await db.delete(calls).where(lt(calls.expiresAt, now));
  } catch {
    // ignore prune errors — not critical
  }
}

export async function GET() {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await pruneExpired();

  try {
    const rows = await db
      .select()
      .from(calls)
      .orderBy(desc(calls.createdAt))
      .limit(20);

    // Filter to not-expired (prune is lazy, so filter here too)
    const now = Date.now();
    const active = rows.filter((r) => new Date(r.expiresAt).getTime() > now);

    return NextResponse.json({ calls: active });
  } catch (err) {
    console.error("[calls/rooms][GET]", err);
    return NextResponse.json({ error: "Could not list calls." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON. Send { type: 'voice'|'video', context?: 'standalone'|'project'|'checkpoint', contextId?: string }." }, { status: 400 });
  }

  const { type, context, contextId } = body as {
    type?: unknown;
    context?: unknown;
    contextId?: unknown;
  };

  if (type !== "voice" && type !== "video") {
    return NextResponse.json({ error: "type must be 'voice' or 'video'." }, { status: 400 });
  }
  const callType = type as CallType;

  let callContext: CallContext = "standalone";
  if (context === "project" || context === "checkpoint" || context === "standalone") {
    callContext = context;
  } else if (context !== undefined && context !== null) {
    return NextResponse.json({ error: "context must be 'standalone', 'project', or 'checkpoint'." }, { status: 400 });
  }

  let ctxId: string | null = null;
  if (typeof contextId === "string" && contextId.trim()) {
    // Basic validation — contextId should be a UUID or short id, not arbitrary long string
    if (contextId.length > 64) {
      return NextResponse.json({ error: "contextId too long." }, { status: 400 });
    }
    ctxId = contextId.trim();
  }

  // If Daily key is placeholder (build), return a mock room for typecheck/build
  let dailyApiKey: string;
  try {
    dailyApiKey = requireDailyApiKey();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (dailyApiKey.startsWith("build-phase-placeholder")) {
    if (isBuildPhase()) {
      const mockName = `mock-${callType}-${Date.now()}`;
      const mockUrl = `https://vaayu.daily.co/${mockName}`;
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const [inserted] = await db
        .insert(calls)
        .values({
          type: callType,
          context: callContext,
          contextId: ctxId,
          dailyRoomName: mockName,
          dailyRoomUrl: mockUrl,
          createdBy: user.id,
          expiresAt,
        })
        .returning();
      return NextResponse.json({ call: inserted, dailyRoomUrl: mockUrl, dailyRoomName: mockName }, { status: 201 });
    }
    return NextResponse.json(
      { error: "Calls are not configured — DAILY_API_KEY is missing. Add it in Vercel env vars (Daily.co dashboard → Developers → API keys) and redeploy." },
      { status: 503 }
    );
  }

  const roomName = dailyRoomNameFor(callType, callContext, ctxId);
  const props = dailyRoomProperties(callType);

  // Daily room creation — server-only, never exposes API key to client
  try {
    const dailyRes = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dailyApiKey}`,
      },
      body: JSON.stringify({
        name: roomName,
        privacy: "public",
        properties: {
          ...props,
          enable_network_ui: true,
          enable_people_ui: true,
        },
      }),
      cache: "no-store",
    });

    const dailyData = (await dailyRes.json().catch(() => null)) as {
      name?: string;
      url?: string;
      error?: string;
      info?: unknown;
    } | null;

    if (!dailyRes.ok || !dailyData?.name || !dailyData?.url) {
      console.error("[calls/rooms] Daily API error", dailyRes.status, dailyData);
      const msg = typeof dailyData?.error === "string" ? dailyData.error : `Daily room creation failed (HTTP ${dailyRes.status})`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

    const [inserted] = await db
      .insert(calls)
      .values({
        type: callType,
        context: callContext,
        contextId: ctxId,
        dailyRoomName: dailyData.name,
        dailyRoomUrl: dailyData.url,
        createdBy: user.id,
        expiresAt,
      })
      .returning();

    console.log(`[calls/rooms] created ${callType} room ${dailyData.name} for ${callContext}${ctxId ? `:${ctxId.slice(0, 8)}` : ""} by ${user.email}`);

    return NextResponse.json(
      {
        call: inserted,
        dailyRoomName: dailyData.name,
        dailyRoomUrl: dailyData.url,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[calls/rooms][POST]", err);
    return NextResponse.json({ error: "Could not create call room. Please try again." }, { status: 502 });
  }
}
