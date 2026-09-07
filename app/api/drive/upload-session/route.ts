import { NextResponse } from "next/server";
import {
  createResumableUploadSession,
  DriveValidationError,
  getDriveAccessToken,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/drive/upload-session — mint a resumable upload session.
 *
 * Body (JSON): { name, size, mimeType }. Any signed-in user may mint one.
 *
 * The folder lock is enforced here, server-side: the session pins
 * parents=[GOOGLE_DRIVE_UPLOAD_FOLDER_ID], so bytes the browser PUTs to the
 * returned sessionUri cannot land anywhere else. The session URI is a
 * capability URL — no Google credentials reach the browser. Use it for files
 * of any size (Google multipart caps at 5 MB; sessions scale to our 500 MB
 * app limit and beyond).
 */
export async function POST(req: Request) {
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
      { error: "Invalid JSON. Send { name, size, mimeType }." },
      { status: 400 }
    );
  }

  const { name, size, mimeType } = (body ?? {}) as {
    name?: unknown;
    size?: unknown;
    mimeType?: unknown;
  };

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    const session = await createResumableUploadSession(accessToken, {
      name: typeof name === "string" ? name : "upload",
      mimeType: typeof mimeType === "string" ? mimeType : "",
      size: typeof size === "number" ? size : 0,
      folderId: drive.folderId,
    });
    console.log(
      `[drive/upload-session] session for (${session.fileName}) into folder (${drive.folderId}) by (${user.email})`
    );
    return NextResponse.json(
      { sessionUri: session.sessionUri, fileName: session.fileName },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DriveValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[drive/upload-session]", err);
    return NextResponse.json(
      { error: "Could not start the upload session. Please try again." },
      { status: 502 }
    );
  }
}
