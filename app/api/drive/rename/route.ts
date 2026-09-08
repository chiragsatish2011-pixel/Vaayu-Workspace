import { NextRequest, NextResponse } from "next/server";
import {
  getDriveAccessToken,
  isDescendantOfFolder,
  renameDriveFile,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drive/rename — rename a file or folder in Drive (name only,
 * location untouched). Body: { id: string, name: string }. Any signed-in
 * user may rename, but ONLY items strictly inside the locked team folder —
 * the team root itself can never be renamed through the app.
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
      { error: "Invalid JSON. Send { id, name }." },
      { status: 400 }
    );
  }

  const { id, name } = (body ?? {}) as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Provide { id: <Drive id>, name: <new name> }." },
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
        { error: "Only items inside the team folder can be renamed." },
        { status: 403 }
      );
    }
    const renamed = await renameDriveFile(accessToken, id, name);
    console.log(
      `[drive/rename] id=${renamed.id} → (${renamed.name}) by (${user.email})`
    );
    return NextResponse.json(renamed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/HTTP 404/.test(message)) {
      return NextResponse.json({ error: "File or folder not found." }, { status: 404 });
    }
    console.error("[drive/rename]", err);
    return NextResponse.json(
      { error: "Could not rename. Please try again." },
      { status: 502 }
    );
  }
}
