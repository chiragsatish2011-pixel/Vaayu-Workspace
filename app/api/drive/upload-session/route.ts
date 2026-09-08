import { NextResponse } from "next/server";
import {
  createResumableUploadSession,
  getDriveAccessToken,
  invalidateDriveBrowseCache,
  uploadHttpError,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/drive/upload-session — mint a resumable upload session.
 *
 * Body (JSON): { name, size, mimeType, relativePath? }. Any signed-in user
 * may mint one.
 *
 * The folder lock is enforced here, server-side: `relativePath` (the
 * file's path inside a dropped/picked folder, e.g. "myproj/src/a.ts") is
 * sanitized and resolved into subfolders strictly INSIDE
 * GOOGLE_DRIVE_UPLOAD_FOLDER_ID, and the session pins
 * parents=[deepestSubfolder] — so bytes the browser PUTs to the returned
 * sessionUri cannot land anywhere else. The session URI is a capability
 * URL — no Google credentials reach the browser.
 *
 * No app-level size/type caps: any file type Drive stores and any size up
 * to Drive's own 5 TB single-file ceiling is accepted. Drive-side
 * rejections (5 TB breach, 750 GB/day account cap, full storage) are
 * forwarded with clear, specific messages via uploadHttpError.
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
      { error: "Invalid JSON. Send { name, size, mimeType, relativePath? }." },
      { status: 400 }
    );
  }

  const { name, size, mimeType, relativePath } = (body ?? {}) as {
    name?: unknown;
    size?: unknown;
    mimeType?: unknown;
    relativePath?: unknown;
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
      size: typeof size === "number" ? size : NaN,
      folderId: drive.folderId,
      relativePath,
    });
    console.log(
      `[drive/upload-session] session for (${session.fileName}) into folder (${session.parentFolderId}) by (${user.email})`
    );
    return NextResponse.json(
      {
        sessionUri: session.sessionUri,
        fileName: session.fileName,
        parentFolderId: session.parentFolderId,
        topFolderId: session.topFolderId,
      },
      { status: 201 }
    );
  } catch (err) {
    const mapped = uploadHttpError(err);
    if (mapped.status >= 500) console.error("[drive/upload-session]", err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
