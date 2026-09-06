import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";

/**
 * PATCH /api/user/profile
 * Allows logged-in users to update their own profile fields (e.g. `name`).
 */
export async function PATCH(req: Request) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let name: string | null = null;
  if (typeof body.name === "string") {
    name = body.name.trim();
    if (name.length === 0) {
      name = null;
    } else if (name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or fewer" },
        { status: 400 }
      );
    }
  } else if (body.name === null || body.name === undefined) {
    name = null;
  } else {
    return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
  }

  try {
    const updated = await db
      .update(users)
      .set({ name })
      .where(eq(users.id, sessionUser.id))
      .returning({ id: users.id, email: users.email, role: users.role, name: users.name });

    return NextResponse.json({
      user: updated[0] ?? { ...sessionUser, name },
    });
  } catch (err) {
    console.error("[api/user/profile] failed to update name:", err);
    return NextResponse.json(
      { error: "Failed to update profile name" },
      { status: 500 }
    );
  }
}
