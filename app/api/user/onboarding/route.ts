import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({
    hasCompletedOnboarding: Boolean(caller.hasCompletedOnboarding),
    displayName: caller.displayName ?? null,
    role: caller.role,
  });
}

export async function POST(req: Request) {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { displayName, role, useCase } = body as {
    displayName?: unknown;
    role?: unknown;
    useCase?: unknown;
  };

  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 40) {
    return NextResponse.json({ error: "Display name must be 2–40 characters." }, { status: 400 });
  }
  const trimmedName = displayName.trim();
  // Validate role against existing enum - only admin/member allowed
  let targetRole: "admin" | "member" = "member";
  if (role === "admin" || role === "member") {
    // Prevent privilege escalation: only allow self-promotion to admin if no admin exists yet
    // or if caller is already admin. Otherwise keep as member.
    if (role === "admin") {
      if (caller.role === "admin") {
        targetRole = "admin";
      } else {
        const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
        if (admins.length === 0) targetRole = "admin";
        else targetRole = "member";
      }
    } else {
      targetRole = "member";
    }
  }

  // useCase is just for polishing, not stored beyond maybe displayName
  // We store displayName, role if changed, and mark onboarding complete
  try {
    const updates: Partial<typeof users.$inferInsert> & { hasCompletedOnboarding?: boolean } = {
      displayName: trimmedName,
      hasCompletedOnboarding: true,
    };
    if (targetRole !== caller.role) {
      (updates as Record<string, unknown>).role = targetRole;
    }
    await db.update(users).set(updates as Record<string, unknown>).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true, displayName: trimmedName, role: targetRole, useCase: typeof useCase === "string" ? useCase : null });
  } catch (err) {
    console.error("[api/user/onboarding]", err);
    return NextResponse.json({ error: "Could not complete onboarding." }, { status: 500 });
  }
}
