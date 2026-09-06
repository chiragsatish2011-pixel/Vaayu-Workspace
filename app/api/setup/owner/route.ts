import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSetupStatus } from "@/lib/setup";

/**
 * POST /api/setup/owner { email, password } — create the FIRST account as
 * admin, with must_change_password = false (owner chose it directly).
 *
 * ONE-TIME SETUP GATE — this is NOT a public sign-up path. It refuses when
 * ANY user already exists (COUNT(*) > 0 via getSetupStatus().hasUsers), so
 * it can never hijack a live workspace or become open registration. After
 * this, all further accounts are created by admins via /admin — there is no
 * public registration.
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
    const status = await getSetupStatus();
    if (!status.reachable) {
      return NextResponse.json(
        { error: "Database isn't reachable. Complete steps 1–2 first." },
        { status: 503 }
      );
    }
    if (!status.tables) {
      return NextResponse.json(
        { error: "Tables don't exist yet. Run step 2 first." },
        { status: 409 }
      );
    }
    // Self-disable: ANY existing user locks the wizard permanently.
    const alreadySetup = status.hasUsers || status.admin;
    if (alreadySetup) {
      return NextResponse.json(
        { error: "An owner already exists. Sign in instead." },
        { status: 403 }
      );
    }

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await db
      .insert(users)
      .values({ email, passwordHash, role: "admin", mustChangePassword: false })
      .returning({ id: users.id, email: users.email });

    console.log(`[setup/owner] owner account created (${email})`);
    return NextResponse.json(
      { id: inserted[0].id, email: inserted[0].email },
      { status: 201 }
    );
  } catch (err) {
    console.error("[setup/owner]", err);
    return NextResponse.json(
      { error: "Couldn't create the owner account. Please try again." },
      { status: 500 }
    );
  }
}
