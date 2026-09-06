import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/account/password { currentPassword, newPassword } — change your
 * own password. Also clears `must_change_password`, which releases
 * first-login accounts into the workspace.
 *
 * - Caller must be signed in (401 otherwise). Requires the CURRENT password,
 *   so a stolen session alone can't lock the owner out.
 * - New password is bcrypt-hashed (cost 12); plaintext never stored/logged.
 * - Stateless serverless handler: session check, one lookup, one update.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json(
      { error: "Current password is required." },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current one." },
      { status: 400 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      console.error("[account/password] denied: unauthenticated change attempt");
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const user = rows[0];
    if (!user) {
      console.error(
        `[account/password] denied: session for unknown user id (${session.user.id})`
      );
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      console.error(
        `[account/password] rejected: wrong current password (${user.email})`
      );
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 401 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, user.id));

    console.log(`[account/password] password changed (${user.email})`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[account/password] unexpected error:", err);
    return NextResponse.json(
      { error: "Couldn't change the password. Please try again." },
      { status: 500 }
    );
  }
}
