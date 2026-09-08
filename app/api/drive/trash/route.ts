import { NextRequest, NextResponse } from "next/server";
import {
  getDriveAccessToken,
  isDescendantOfFolder,
  isValidDriveFileId,
  trashDriveFile,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk trash is capped so one request can't churn the whole Drive. */
const MAX_TRASH_IDS = 100;

/**
 * POST /api/drive/trash — move files/folders to Drive trash (recoverable
 * via the Drive UI's Trash, NOT permanent). Body: { ids: string[] }.
 * Any signed-in user may trash, but ONLY items strictly inside the locked
 * team folder (GOOGLE_DRIVE_UPLOAD_FOLDER_ID) — ids from anywhere else
 * are refused per id, never trashed.
 *
 * Responds 200 with per-id results so the UI can optimistically remove
 * what succeeded and surface exactly what failed:
 * { trashed: string[], failed: [{ id, error }] }
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
      { error: "Invalid JSON. Send { ids: [<Drive ids>] }." },
      { status: 400 }
    );
  }

  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "Provide { ids: [<Drive file/folder ids>] }." },
      { status: 400 }
    );
  }
  if (ids.length > MAX_TRASH_IDS) {
    return NextResponse.json(
      { error: `Too many items at once (max ${MAX_TRASH_IDS}). Select fewer.` },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );

    const trashed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    // Dedupe (multi-select of a folder + its children can overlap).
    for (const id of new Set(ids)) {
      if (!isValidDriveFileId(id)) {
        failed.push({ id, error: "Invalid Drive id." });
        continue;
      }
      try {
        const inside = await isDescendantOfFolder(
          accessToken,
          id,
          drive.folderId
        );
        if (!inside) {
          failed.push({
            id,
            error: "Not inside the team folder — refusing to trash.",
          });
          continue;
        }
        await trashDriveFile(accessToken, id);
        trashed.push(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        failed.push({
          id,
          error: /HTTP 404/.test(message)
            ? "Not found (may already be trashed)."
            : "Drive trash failed. Please try again.",
        });
      }
    }

    console.log(
      `[drive/trash] trashed=${trashed.length} failed=${failed.length} by (${user.email})`
    );
    return NextResponse.json({ trashed, failed });
  } catch (err) {
    console.error("[drive/trash]", err);
    return NextResponse.json(
      { error: "Drive trash failed. Please try again." },
      { status: 502 }
    );
  }
}
