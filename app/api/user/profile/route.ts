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
  const { displayName, department, jobTitle } = body as {
    displayName?: unknown;
    department?: unknown;
    jobTitle?: unknown;
  };

  const updates: Record<string, unknown> = {};

  if (displayName !== undefined) {
    if (typeof displayName !== "string") {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      return NextResponse.json({ error: "Display name must be 2–40 characters." }, { status: 400 });
    }
    if (!/^[\p{L}\p{N}\s._'-]+$/u.test(trimmed)) {
      return NextResponse.json({ error: "Display name contains invalid characters." }, { status: 400 });
    }
    updates.displayName = trimmed;
  }

  if (department !== undefined) {
    if (typeof department !== "string" || !["Design", "Engineering", "Marketing"].includes(department)) {
      return NextResponse.json({ error: "Department must be Design, Engineering, or Marketing." }, { status: 400 });
    }
    updates.department = department;
  }

  if (jobTitle !== undefined) {
    if (typeof jobTitle !== "string" || jobTitle.trim().length < 2 || jobTitle.trim().length > 40) {
      return NextResponse.json({ error: "Role/title must be 2–40 characters." }, { status: 400 });
    }
    updates.jobTitle = jobTitle.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    await db.update(users).set(updates).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true, ...updates });
  } catch (err) {
    console.error("[api/user/profile]", err);
    return NextResponse.json({ error: "Could not update profile." }, { status: 500 });
  }
}
