import { NextRequest, NextResponse } from "next/server";
import {
  createDriveFolder,
  getDriveAccessToken,
  isDescendantOfFolder,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drive/create-folder — create a real subfolder in Drive.
 * Body: { parentId: string, name: string }. Any signed-in user may create,
 * but ONLY inside the locked team folder (GOOGLE_DRIVE_UPLOAD_FOLDER_ID):
 * the parent must be the root itself or a descendant of it — verified
 * server-side before anything is created.
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
      { error: "Invalid JSON. Send { parentId, name }." },
      { status: 400 }
    );
  }

  const { parentId, name } = (body ?? {}) as {
    parentId?: unknown;
    name?: unknown;
  };
  if (typeof parentId !== "string" || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Provide { parentId: <Drive folder id>, name: <folder name> }." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    // Parent must be the locked root or live under it — never elsewhere.
    const parentOk =
      parentId === drive.folderId ||
      (await isDescendantOfFolder(accessToken, parentId, drive.folderId));
    if (!parentOk) {
      return NextResponse.json(
        { error: "Folders can only be created inside the team folder." },
        { status: 403 }
      );
    }
    const folder = await createDriveFolder(accessToken, parentId, name);
    console.log(
      `[drive/create-folder] (${folder.name}) id=${folder.id} under (${parentId}) by (${user.email})`
    );
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    console.error("[drive/create-folder]", err);
    return NextResponse.json(
      { error: "Could not create folder. Please try again." },
      { status: 502 }
    );
  }
}
