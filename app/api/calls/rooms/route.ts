import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, lt } from "drizzle-orm";
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

export async function GET(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const history = url.searchParams.get("history") === "1" || url.searchParams.get("all") === "1";

  // For active view, keep lazy prune of expired (4h). For history, don't prune — show last 50 regardless.
  if (!history) await pruneExpired();

  try {
    const rows = await db
      .select()
      .from(calls)
      .orderBy(desc(calls.createdAt))
      .limit(history ? 50 : 20);

    if (history) {
      return NextResponse.json({ calls: rows });
    }

    // Active filter
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
  const requestPayload = {
    name: roomName,
    privacy: "public" as const,
    properties: {
      ...props,
      enable_network_ui: true,
      enable_people_ui: true,
    },
  };
  const keyPreview = `${dailyApiKey.slice(0, 4)}…${dailyApiKey.slice(-4)} (len ${dailyApiKey.length})`;
  // Verbose request logging gated behind DAILY_DEBUG
  if (process.env.DAILY_DEBUG === "1") {
    console.log(`[calls/rooms][debug] creating Daily room type=${callType} context=${callContext}${ctxId ? `:${ctxId.slice(0, 8)}` : ""} name=${roomName} key=${keyPreview} payload=${JSON.stringify(requestPayload)}`);
  }

  try {
    const dailyRes = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dailyApiKey}`,
      },
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    });

    const dailyText = await dailyRes.text().catch(() => "");
    let dailyData: { name?: string; url?: string; error?: string; info?: unknown } | null = null;
    try {
      dailyData = dailyText ? (JSON.parse(dailyText) as { name?: string; url?: string; error?: string; info?: unknown } | null) : null;
    } catch {
      // non-JSON error body
    }

    const dailyName = (dailyData as { name?: string } | null)?.name;
    const dailyUrl = (dailyData as { url?: string } | null)?.url;
    if (!dailyRes.ok || !dailyName || !dailyUrl) {
      // Log full Daily response (including info) for diagnosis — payload only when DAILY_DEBUG=1 to avoid verbose prod logs
      const payloadLog = process.env.DAILY_DEBUG === "1" ? ` payload=${JSON.stringify(requestPayload)}` : "";
      console.error(
        `[calls/rooms] Daily API error status=${dailyRes.status}${payloadLog} responseText=${dailyText.slice(0, 1000)} parsed=${JSON.stringify(dailyData)?.slice(0, 1000)} key=${keyPreview} url=https://api.daily.co/v1/rooms`
      );
      const info = (dailyData as { info?: unknown } | null)?.info;
      const infoStr = typeof info === "string" ? info : info ? JSON.stringify(info).slice(0, 300) : "";
      const errMsg = (dailyData as { error?: unknown } | null)?.error;
      const msg =
        typeof errMsg === "string"
          ? `${errMsg}${infoStr ? ` — ${infoStr}` : ""} (HTTP ${dailyRes.status})`
          : infoStr
            ? `Daily invalid-request: ${infoStr} (HTTP ${dailyRes.status})`
            : `Daily room creation failed (HTTP ${dailyRes.status}) — info: ${dailyText.slice(0, 300) || "no body"}`;
      return NextResponse.json({ error: msg, info: infoStr || dailyText.slice(0, 500), status: dailyRes.status }, { status: 502 });
    }

    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

    const [inserted] = await db
      .insert(calls)
      .values({
        type: callType,
        context: callContext,
        contextId: ctxId,
        dailyRoomName: dailyName!,
        dailyRoomUrl: dailyUrl!,
        createdBy: user.id,
        expiresAt,
      })
      .returning();

    console.log(`[calls/rooms] created ${callType} room ${dailyName} for ${callContext}${ctxId ? `:${ctxId.slice(0, 8)}` : ""} by ${user.email}`);

    return NextResponse.json(
      {
        call: inserted,
        dailyRoomName: dailyName,
        dailyRoomUrl: dailyUrl,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[calls/rooms][POST]", err);
    return NextResponse.json({ error: "Could not create call room. Please try again." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON. Send { id: string } or { ids: string[] }." }, { status: 400 });
  }

  const raw = body as { id?: unknown; ids?: unknown };
  let ids: string[] = [];
  if (typeof raw.id === "string" && raw.id.trim()) ids = [raw.id.trim()];
  else if (Array.isArray(raw.ids)) ids = raw.ids.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());

  if (ids.length === 0) return NextResponse.json({ error: "No call id(s) provided." }, { status: 400 });
  if (ids.length > 50) return NextResponse.json({ error: "Too many ids (max 50)." }, { status: 400 });

  // Fetch to check perms and get Daily names
  const rows = await db.select().from(calls).where(inArray(calls.id, ids));
  if (rows.length === 0) return NextResponse.json({ error: "Call not found." }, { status: 404 });

  const allowed: typeof rows = [];
  const forbidden: string[] = [];
  for (const r of rows) {
    if (r.createdBy === user.id || user.role === "admin") allowed.push(r);
    else forbidden.push(r.id);
  }
  if (forbidden.length > 0) {
    return NextResponse.json({ error: `Not allowed to delete ${forbidden.length} call(s). Only organizer or Admin can delete.`, forbidden }, { status: 403 });
  }

  // Hard delete from DB
  await db.delete(calls).where(inArray(calls.id, allowed.map((r) => r.id)));

  // Best-effort Daily.co room deletion (rooms are ephemeral anyway, 4h expiry). Recordings are out of scope: enable_recording is false, so no recordings to delete.
  try {
    const dailyApiKey = requireDailyApiKey();
    if (!dailyApiKey.startsWith("build-phase-placeholder")) {
      await Promise.all(
        allowed.map(async (r) => {
          try {
            await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(r.dailyRoomName)}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${dailyApiKey}` },
              cache: "no-store",
            });
          } catch {}
        })
      );
    }
  } catch {}

  console.log(`[calls/rooms][DELETE] ${allowed.length} call(s) hard-deleted by ${user.email}: ${allowed.map((r) => r.id).join(",")}`);

  return NextResponse.json({ deleted: allowed.map((r) => r.id), count: allowed.length });
}
