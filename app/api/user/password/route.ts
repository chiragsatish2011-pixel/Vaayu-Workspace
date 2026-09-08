import bcrypt from "bcryptjs";
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
  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "Current password is required." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  if (newPassword.length > 128) {
    return NextResponse.json({ error: "New password is too long (max 128)." }, { status: 400 });
  }

  try {
    const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, caller.id)).limit(1);
    const user = rows[0];
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/user/password]", err);
    return NextResponse.json({ error: "Could not change password." }, { status: 500 });
  }
}
