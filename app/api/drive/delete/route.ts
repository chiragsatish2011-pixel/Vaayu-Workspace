import { NextRequest, NextResponse } from "next/server";
import {
  deleteDriveFile,
  getDriveAccessToken,
  isValidDriveFileId,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * DELETE /api/drive/delete?id=<driveFileId> — permanently deletes the
 * file from the owner's Drive (Drive delete is not a trash move).
 */
export async function DELETE(req: NextRequest) {
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

  const id = new URL(req.url).searchParams.get("id");
  if (!isValidDriveFileId(id)) {
    return NextResponse.json(
      { error: "A valid Drive file id is required." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    await deleteDriveFile(accessToken, id);
    console.log(`[drive/delete] id=${id} by (${user.email})`);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/HTTP 404/.test(message)) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    console.error("[drive/delete]", err);
    return NextResponse.json(
      { error: "Drive delete failed. Please try again." },
      { status: 502 }
    );
  }
}
