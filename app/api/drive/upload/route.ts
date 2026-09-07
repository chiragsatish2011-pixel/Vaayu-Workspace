import { NextRequest, NextResponse } from "next/server";
import {
  ensureSubfolderPath,
  getDriveAccessToken,
  MULTIPART_MAX_BYTES,
  resolveUploadDestination,
  uploadDriveFile,
  uploadHttpError,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/drive/upload — multipart form { kind: "codebase"|"preview",
 * file: File, relativePath?: string }. Any signed-in user may upload; files
 * land strictly in the pre-assigned folder (GOOGLE_DRIVE_UPLOAD_FOLDER_ID),
 * enforced server-side — an optional `relativePath` recreates subfolders
 * strictly INSIDE it, never outside. Any file type Drive stores is
 * accepted (no extension/MIME gating), at any size Drive itself allows.
 * Filenames are sanitized so no path can escape the folder. Browser never
 * touches Google credentials.
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
      { error: "Invalid form data. Send multipart { kind, file, relativePath? }." },
      { status: 400 }
    );
  }

  const kind = form.get("kind");
  const file = form.get("file");
  const relativePathRaw = form.get("relativePath");
  if (kind !== "codebase" && kind !== "preview") {
    return NextResponse.json(
      { error: 'Field "kind" must be "codebase" or "preview".' },
      { status: 400 }
    );
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "A file is required." },
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

  try {
    const dest = resolveUploadDestination(
      typeof relativePathRaw === "string" ? relativePathRaw : undefined,
      originalName,
      file.size
    );
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    const { parentFolderId } = await ensureSubfolderPath(
      accessToken,
      drive.folderId,
      dest.dirParts
    );
    const saved = await uploadDriveFile(accessToken, {
      name: dest.fileName,
      mimeType: file.type || "application/octet-stream",
      bytes: file,
      folderId: parentFolderId,
    });
    console.log(
      `[drive/upload] (${saved.name}) id=${saved.id} into folder (${parentFolderId}) by (${user.email})`
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
    const mapped = uploadHttpError(err);
    if (mapped.status >= 500) console.error("[drive/upload]", err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
