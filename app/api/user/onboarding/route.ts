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
    department: caller.department ?? null,
    jobTitle: caller.jobTitle ?? null,
  });
}

const VALID_DEPARTMENTS = ["Design", "Engineering", "Marketing"] as const;

export async function POST(req: Request) {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { displayName, department, jobTitle } = body as {
    displayName?: unknown;
    department?: unknown;
    jobTitle?: unknown;
  };

  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 40) {
    return NextResponse.json({ error: "Display name must be 2–40 characters." }, { status: 400 });
  }
  if (typeof department !== "string" || !VALID_DEPARTMENTS.includes(department as (typeof VALID_DEPARTMENTS)[number])) {
    return NextResponse.json({ error: "Please select a valid field: Design, Engineering, or Marketing." }, { status: 400 });
  }
  if (typeof jobTitle !== "string" || jobTitle.trim().length < 2 || jobTitle.trim().length > 40) {
    return NextResponse.json({ error: "Role/title must be 2–40 characters." }, { status: 400 });
  }
  const trimmedName = displayName.trim();
  const trimmedDept = department as string;
  const trimmedTitle = jobTitle.trim();

  // System role (admin/member) is NOT set here — stays admin-controlled via /admin only
  try {
    await db
      .update(users)
      .set({
        displayName: trimmedName,
        department: trimmedDept,
        jobTitle: trimmedTitle,
        hasCompletedOnboarding: true,
      })
      .where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true, displayName: trimmedName, department: trimmedDept, jobTitle: trimmedTitle });
  } catch (err) {
    console.error("[api/user/onboarding]", err);
    return NextResponse.json({ error: "Could not complete onboarding." }, { status: 500 });
  }
}
