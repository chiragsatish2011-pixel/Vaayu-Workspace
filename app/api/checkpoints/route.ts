import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  CheckpointForbiddenError,
  CheckpointNotFoundError,
  createCheckpoint,
  deleteCheckpoint,
  getCheckpoints,
  updateCheckpoint,
} from "@/lib/checkpoints-store";
import { requireApiSession } from "@/lib/session";

async function enrichCheckpoints<T extends { userId: string; displayName: string | null; userEmail: string; avatarDriveId?: string | null }>(
  rows: T[]
): Promise<(T & { avatarDriveId: string | null })[]> {
  if (rows.length === 0) return rows as (T & { avatarDriveId: string | null })[];
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  if (ids.length === 0) return rows as (T & { avatarDriveId: string | null })[];
  try {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName, avatarDriveId: users.avatarDriveId, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
    const byId = new Map(userRows.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = byId.get(r.userId);
      return {
        ...r,
        displayName: u?.displayName ?? r.displayName,
        userEmail: u?.email ?? r.userEmail,
        avatarDriveId: u?.avatarDriveId ?? null,
      } as T & { avatarDriveId: string | null };
    });
  } catch {
    return rows as (T & { avatarDriveId: string | null })[];
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/checkpoints — CRUD over the "Checkpoints" Google Sheet
 * (lib/checkpoints-store.ts). Auth/session stays on Neon; the sheet is the
 * checkpoints database. Update/delete are author-or-admin.
 */

function storeError(err: unknown): { error: string } {
  console.error(
    "[api/checkpoints] store error:",
    err instanceof Error ? err.message : err
  );
  return {
    error:
      err instanceof Error && err.message
        ? err.message
        : "Checkpoints storage failed.",
  };
}

export async function GET() {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await getCheckpoints();
    const checkpoints = await enrichCheckpoints(raw as unknown as { userId: string; displayName: string | null; userEmail: string; avatarDriveId?: string | null }[]);
    return NextResponse.json({ checkpoints });
  } catch (err) {
    return NextResponse.json(storeError(err), { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    // Support both plain note and structured Tiptap JSON (for @mentions)
    const noteRaw = typeof body.note === "string" ? body.note : typeof body.content === "string" ? body.content : "";
    const note = noteRaw.trim();
    const contentJsonRaw = body.contentJson ?? body.content_json ?? null;
    let contentJson: string | null = null;
    if (contentJsonRaw !== null && contentJsonRaw !== undefined) {
      if (typeof contentJsonRaw === "string") {
        try {
          JSON.parse(contentJsonRaw);
          contentJson = contentJsonRaw;
        } catch {
          return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
        }
      } else if (typeof contentJsonRaw === "object") {
        contentJson = JSON.stringify(contentJsonRaw);
      }
    }

    if (!note) {
      return NextResponse.json(
        { error: "Note content is required." },
        { status: 400 }
      );
    }

    const rawCheckpoint = await createCheckpoint(user, note, contentJson);
    // Enrich so response carries current avatar/displayName (accurate update after rename)
    const [checkpoint] = await enrichCheckpoints([rawCheckpoint as unknown as { userId: string; displayName: string | null; userEmail: string; avatarDriveId?: string | null }]);
    return NextResponse.json({ checkpoint }, { status: 201 });
  } catch (err) {
    return NextResponse.json(storeError(err), { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = typeof body.id === "string" ? body.id : "";
    const noteRaw = typeof body.note === "string" ? body.note : typeof body.content === "string" ? body.content : "";
    const note = noteRaw.trim();
    const contentJsonRaw = body.contentJson ?? body.content_json ?? null;
    let contentJson: string | null | undefined = undefined;
    if (contentJsonRaw !== null && contentJsonRaw !== undefined) {
      if (typeof contentJsonRaw === "string") {
        try {
          JSON.parse(contentJsonRaw);
          contentJson = contentJsonRaw;
        } catch {
          return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
        }
      } else if (typeof contentJsonRaw === "object") {
        contentJson = JSON.stringify(contentJsonRaw);
      } else {
        contentJson = null;
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "Checkpoint id is required." },
        { status: 400 }
      );
    }
    if (!note) {
      return NextResponse.json(
        { error: "Note content is required." },
        { status: 400 }
      );
    }

    const rawCheckpoint = await updateCheckpoint(user, id, note, contentJson);
    const [checkpoint] = await enrichCheckpoints([rawCheckpoint as unknown as { userId: string; displayName: string | null; userEmail: string; avatarDriveId?: string | null }]);
    return NextResponse.json({ checkpoint });
  } catch (err) {
    if (err instanceof CheckpointNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof CheckpointForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(storeError(err), { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const id =
      body && typeof body.id === "string" ? (body.id as string) : "";

    if (!id) {
      return NextResponse.json(
        { error: "Checkpoint id is required." },
        { status: 400 }
      );
    }

    // Soft-delete (team decision): stamps deleted_at in the sheet; the row
    // stays as history but is hidden from every read.
    await deleteCheckpoint(user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CheckpointNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof CheckpointForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(storeError(err), { status: 500 });
  }
}
