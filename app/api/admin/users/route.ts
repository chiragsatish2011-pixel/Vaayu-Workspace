import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/admin/users { email, password } — admin creates a member account.
 *
 * - Caller must be signed in with role "admin" (401/403 otherwise).
 * - Password is bcrypt-hashed (cost 12) before storing; the plaintext is
 *   never stored, never logged, and never returned — the admin's browser
 *   already holds it and shows it once from its own state.
 * - New accounts get role "member" + must_change_password = true.
 * - Stateless serverless handler: auth check, validate, one lookup, one insert.
 */
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
  const email =
    typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "A valid email address is required." },
      { status: 400 }
    );
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      console.error("[admin/users] denied: unauthenticated create attempt");
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const callers = await db
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      console.error(
        `[admin/users] denied: non-admin create attempt by (${caller?.email ?? session.user.email ?? "unknown"})`
      );
      return NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      );
    }

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
      .values({ email, passwordHash, role: "member", mustChangePassword: true })
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
