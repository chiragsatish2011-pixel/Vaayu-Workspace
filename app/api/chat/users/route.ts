import { and, eq, ilike, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat/users?q= — people picker for New Chat / group member adds.
 * Any signed-in user may list team members (needed to start DMs). Search
 * matches display name or email. Self is excluded (no self-DMs).
 */
export async function GET(req: Request) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const q = (new URL(req.url).searchParams.get("q") || "").trim();
    const base = ne(users.id, user.id);
    const rows = q
      ? await db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            avatarDriveId: users.avatarDriveId,
          })
          .from(users)
          .where(and(base, or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))))
          .limit(20)
      : await db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            avatarDriveId: users.avatarDriveId,
          })
          .from(users)
          .where(base)
          .limit(20);

    return NextResponse.json({ users: rows });
  } catch (err) {
    console.error("[GET /api/chat/users]", err);
    return NextResponse.json({ error: "Failed to list people." }, { status: 500 });
  }
}
