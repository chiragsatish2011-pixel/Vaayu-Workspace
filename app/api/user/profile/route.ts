import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { displayName } = body as { displayName?: unknown };
  if (typeof displayName !== "string") {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    return NextResponse.json({ error: "Display name must be 2–40 characters." }, { status: 400 });
  }
  // Allow letters, numbers, spaces, hyphen, underscore, apostrophe
  if (!/^[\p{L}\p{N}\s._'-]+$/u.test(trimmed)) {
    return NextResponse.json({ error: "Display name contains invalid characters." }, { status: 400 });
  }

  try {
    await db.update(users).set({ displayName: trimmed }).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true, displayName: trimmed });
  } catch (err) {
    console.error("[api/user/profile]", err);
    return NextResponse.json({ error: "Could not update profile." }, { status: 500 });
  }
}
