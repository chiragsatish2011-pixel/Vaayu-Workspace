import { NextResponse } from "next/server";
import {
  CheckpointForbiddenError,
  CheckpointNotFoundError,
  createCheckpoint,
  deleteCheckpoint,
  getCheckpoints,
  updateCheckpoint,
} from "@/lib/checkpoints-store";
import { requireApiSession } from "@/lib/session";

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
    const checkpoints = await getCheckpoints();
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
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!note) {
      return NextResponse.json(
        { error: "Note content is required." },
        { status: 400 }
      );
    }

    const checkpoint = await createCheckpoint(user, note);
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
    const note = typeof body.note === "string" ? body.note.trim() : "";

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

    const checkpoint = await updateCheckpoint(user, id, note);
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
