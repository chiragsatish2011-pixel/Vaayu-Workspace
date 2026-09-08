import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getDriveAccessToken, uploadDriveFile, validateUpload } from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  // Validate image
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are allowed for avatars." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Avatar must be under 5MB." }, { status: 400 });
  }
  const checked = validateUpload(file.name, file.size);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const drive = assertDriveEnv();
    const token = await getDriveAccessToken(drive.clientId, drive.clientSecret, drive.refreshToken);
    const bytes = new Blob([await file.arrayBuffer()], { type: file.type });
    const uploaded = await uploadDriveFile(token, {
      name: `avatar-${caller.id}-${Date.now()}-${checked.name}`,
      mimeType: file.type,
      bytes,
      folderId: drive.folderId,
    });
    await db.update(users).set({ avatarDriveId: uploaded.id, avatarFileName: uploaded.name }).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true, avatarDriveId: uploaded.id });
  } catch (err) {
    console.error("[api/user/avatar]", err);
    return NextResponse.json({ error: "Could not upload avatar." }, { status: 500 });
  }
}

export async function DELETE() {
  const caller = await requireApiSession();
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    await db.update(users).set({ avatarDriveId: null, avatarFileName: null }).where(eq(users.id, caller.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/user/avatar] delete", err);
    return NextResponse.json({ error: "Could not remove avatar." }, { status: 500 });
  }
}
