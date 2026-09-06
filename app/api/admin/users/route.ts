import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Admin-only user management. All three handlers require a signed-in
 * caller with role "admin" (401/403 otherwise) — users have NO
 * self-service credential UI anywhere; every password below is set by an
 * admin and bcrypt-hashed (cost 12) before storing. Plaintext passwords
 * are never stored, never logged, and never returned.
 *
 * - POST   /api/admin/users { email, password } — create a member account.
 * - PATCH  /api/admin/users { id, newPassword } — set a user's password.
 *   No "current password" needed: this is the admin acting on someone
 *   else's account, not a self-service change.
 * - DELETE /api/admin/users { id } — delete a user's account. Admins
 *   cannot delete their own account (that would lock the workspace).
 *
 * Stateless serverless handlers: auth check, validate, lookup, write.
 */

interface Caller {
  id: string;
  email: string;
}

/** Returns the admin caller, or a NextResponse error to return directly. */
async function requireCallerAdmin(): Promise<Caller | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    console.error("[admin/users] denied: unauthenticated attempt");
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const callers = await db
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const caller = callers[0];
  if (!caller || caller.role !== "admin") {
    console.error(
      `[admin/users] denied: non-admin attempt by (${caller?.email ?? session.user.email ?? "unknown"})`
    );
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 }
    );
  }
  return { id: caller.id, email: caller.email };
}

function isValidEmail(email: unknown): email is string {
  return (
    typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toLowerCase().trim())
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { email: rawEmail, password } = body as {
    email?: unknown;
    password?: unknown;
  };
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: "A valid email address is required." },
      { status: 400 }
    );
  }
  const email = rawEmail.toLowerCase().trim();
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const caller = await requireCallerAdmin();
    if (caller instanceof NextResponse) return caller;

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      console.error(
        `[admin/users] create failed: email already exists (${email}), requested by (${caller.email})`
      );
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await db
      .insert(users)
      .values({ email, passwordHash, role: "member" })
      .returning({ id: users.id, email: users.email });

    console.log(
      `[admin/users] account created (${email}) by admin (${caller.email})`
    );
    return NextResponse.json(
      { id: inserted[0].id, email: inserted[0].email },
      { status: 201 }
    );
  } catch (err) {
    console.error(`[admin/users] unexpected error creating (${email}):`, err);
    return NextResponse.json(
      { error: "Couldn't create the account. Please try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { id, newPassword } = body as { id?: unknown; newPassword?: unknown };
  if (typeof id !== "string" || !id) {
    return NextResponse.json(
      { error: "A user id is required." },
      { status: 400 }
    );
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const caller = await requireCallerAdmin();
    if (caller instanceof NextResponse) return caller;

    const targets = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const target = targets[0];
    if (!target) {
      return NextResponse.json(
        { error: "No account found with that id." },
        { status: 404 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, target.id));

    console.log(
      `[admin/users] password changed for (${target.email}) by admin (${caller.email})`
    );
    return NextResponse.json({ ok: true, email: target.email });
  } catch (err) {
    console.error("[admin/users] unexpected error changing password:", err);
    return NextResponse.json(
      { error: "Couldn't change the password. Please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { id } = body as { id?: unknown };
  if (typeof id !== "string" || !id) {
    return NextResponse.json(
      { error: "A user id is required." },
      { status: 400 }
    );
  }

  try {
    const caller = await requireCallerAdmin();
    if (caller instanceof NextResponse) return caller;

    if (id === caller.id) {
      return NextResponse.json(
        { error: "You can't delete your own account." },
        { status: 400 }
      );
    }

    const targets = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const target = targets[0];
    if (!target) {
      return NextResponse.json(
        { error: "No account found with that id." },
        { status: 404 }
      );
    }

    await db.delete(users).where(eq(users.id, target.id));

    console.log(
      `[admin/users] account deleted (${target.email}) by admin (${caller.email})`
    );
    return NextResponse.json({ ok: true, email: target.email });
  } catch (err) {
    console.error("[admin/users] unexpected error deleting account:", err);
    return NextResponse.json(
      { error: "Couldn't delete the account. Please try again." },
      { status: 500 }
    );
  }
}
