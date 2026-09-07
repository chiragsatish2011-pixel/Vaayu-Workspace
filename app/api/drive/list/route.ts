import { NextResponse } from "next/server";
import {
  getDriveAccessToken,
  listDriveFiles,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/drive/list — metadata (id, name, mimeType, size, modifiedTime)
 * for files in the workspace Drive folder, newest first. Metadata only —
 * no bytes, no credentials leave the server.
 */
export async function GET() {
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

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    const files = await listDriveFiles(accessToken, drive.folderId);
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[drive/list]", err);
    return NextResponse.json(
      { error: "Drive list failed. Please try again." },
      { status: 502 }
    );
  }
}
