import { NextResponse } from "next/server";
import { getOnlineUserIds } from "@/lib/chat-bus";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const onlineUserIds = Array.from(getOnlineUserIds());
  return NextResponse.json({ onlineUserIds });
}
