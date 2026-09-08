import { NextRequest, NextResponse } from "next/server";
import {
  getDriveAccessToken,
  isDescendantOfFolder,
  moveDriveFile,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drive/move — move a file/folder to another folder in Drive.
 * Body: { id: string, destinationParentId: string }. Drive has no true
 * "move" endpoint: the helper adds the new parent and removes the old
 * one(s) via files.update addParents/removeParents.
 *
 * Guarded server-side: the item must live inside the locked team folder
 * (and must not BE the team root), the destination must be the root or a
 * descendant of it, and a folder can never be moved into itself or one of
 * its own descendants (cycle refused).
 */
export async function POST(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let drive;
  try {
    drive = assertDriveEnv();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON. Send { id, destinationParentId }." },
      { status: 400 }
    );
  }

  const { id, destinationParentId } = (body ?? {}) as {
    id?: unknown;
    destinationParentId?: unknown;
  };
  if (typeof id !== "string" || typeof destinationParentId !== "string") {
    return NextResponse.json(
      {
        error:
          "Provide { id: <Drive id>, destinationParentId: <Drive folder id> }.",
      },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    if (
      id === drive.folderId ||
      !(await isDescendantOfFolder(accessToken, id, drive.folderId))
    ) {
      return NextResponse.json(
        { error: "Only items inside the team folder can be moved." },
        { status: 403 }
      );
    }
    const destOk =
      destinationParentId === drive.folderId ||
      (await isDescendantOfFolder(
        accessToken,
        destinationParentId,
        drive.folderId
      ));
    if (!destOk) {
      return NextResponse.json(
        { error: "Items can only be moved inside the team folder." },
        { status: 403 }
      );
    }
    // Cycle check: destination inside the moved item (or the item itself)
    // would strand the tree — refuse loudly instead.
    if (
      destinationParentId === id ||
      (await isDescendantOfFolder(accessToken, destinationParentId, id))
    ) {
      return NextResponse.json(
        { error: "A folder cannot be moved into itself or its own subfolder." },
        { status: 400 }
      );
    }
    const moved = await moveDriveFile(accessToken, id, destinationParentId);
    console.log(
      `[drive/move] id=${moved.id} → parent (${destinationParentId}) by (${user.email})`
    );
    return NextResponse.json(moved);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/HTTP 404/.test(message)) {
      return NextResponse.json({ error: "File or folder not found." }, { status: 404 });
    }
    console.error("[drive/move]", err);
    return NextResponse.json(
      { error: "Could not move. Please try again." },
      { status: 502 }
    );
  }
}
