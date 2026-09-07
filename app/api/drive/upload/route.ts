import { NextRequest, NextResponse } from "next/server";
import {
  getDriveAccessToken,
  MULTIPART_MAX_BYTES,
  uploadDriveFile,
  validateUpload,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/drive/upload — multipart form { kind: "codebase"|"preview",
 * file: File }. Any signed-in user may upload; files land strictly in the
 * pre-assigned folder (GOOGLE_DRIVE_UPLOAD_FOLDER_ID), enforced server-side.
 * Any file type Drive supports is accepted (no extension/MIME gating);
 * 0-byte files and files over the app limit are rejected. Filenames are
 * sanitized so no path can escape the folder. Browser never touches Google
 * credentials.
 *
 * Small-file proxy only: Google multipart caps at 5 MB — larger files must
 * use POST /api/drive/upload-session (resumable, direct browser→Google).
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data. Send multipart { kind, file }." },
      { status: 400 }
    );
  }

  const kind = form.get("kind");
  const file = form.get("file");
  if (kind !== "codebase" && kind !== "preview") {
    return NextResponse.json(
      { error: 'Field "kind" must be "codebase" or "preview".' },
      { status: 400 }
    );
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "A non-empty file is required." },
      { status: 400 }
    );
  }
  if (file.size > MULTIPART_MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          "This file is too large for direct upload — start a resumable upload session instead.",
      },
      { status: 413 }
    );
  }

  const originalName =
    file instanceof File && file.name ? file.name : "upload";
  const checked = validateUpload(originalName, file.size);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    const saved = await uploadDriveFile(accessToken, {
      name: checked.name,
      mimeType: file.type || "application/octet-stream",
      bytes: file,
      folderId: drive.folderId,
    });
    console.log(
      `[drive/upload] (${saved.name}) id=${saved.id} into folder (${drive.folderId}) by (${user.email})`
    );
    return NextResponse.json(
      {
        id: saved.id,
        name: saved.name,
        mimeType: saved.mimeType,
        size: saved.size ?? String(file.size),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[drive/upload]", err);
    return NextResponse.json(
      { error: "Drive upload failed. Please try again." },
      { status: 502 }
    );
  }
}
