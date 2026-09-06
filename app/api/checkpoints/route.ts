import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { checkpoints, users } from "@/db/schema";
import { requireApiSession } from "@/lib/session";

export async function GET() {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db
      .select({
        id: checkpoints.id,
        note: checkpoints.note,
        createdAt: checkpoints.createdAt,
        userId: checkpoints.userId,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(checkpoints)
      .innerJoin(users, eq(checkpoints.userId, users.id))
      .orderBy(desc(checkpoints.createdAt));

    return NextResponse.json({ checkpoints: rows });
  } catch (err) {
    console.error("[api/checkpoints] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch checkpoints." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!note) {
      return NextResponse.json(
        { error: "Note content is required." },
        { status: 400 }
      );
    }

    const inserted = await db
      .insert(checkpoints)
      .values({
        userId: user.id,
        note,
      })
      .returning();

    const newCheckpoint = inserted[0];

    return NextResponse.json({
      checkpoint: {
        id: newCheckpoint.id,
        note: newCheckpoint.note,
        createdAt: newCheckpoint.createdAt,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
      },
    });
  } catch (err) {
    console.error("[api/checkpoints] POST error:", err);
    return NextResponse.json(
      { error: "Failed to create checkpoint." },
      { status: 500 }
    );
  }
}
