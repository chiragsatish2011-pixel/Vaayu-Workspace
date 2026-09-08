import { NextResponse } from "next/server";
import { getDriveAccessToken } from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/root — the team Files browser root. Returns the locked
 * folder's opaque Drive id plus its display name (resolved live via the
 * Drive API, falling back to a static label). The id is not a secret —
 * Drive ids already appear throughout the UI — but the folder id env var
 * itself is still only ever read here, server-side. No credentials, no
 * tokens ever reach the browser (same pattern as every /api/drive route).
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
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(drive.folderId)}?fields=id,name,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (metaRes.status === 404) {
      return NextResponse.json(
        { error: "Team folder not found in Drive." },
        { status: 404 }
      );
    }
    if (!metaRes.ok) {
      throw new Error(`[drive] root metadata failed (HTTP ${metaRes.status})`);
    }
    const meta = (await metaRes.json()) as {
      id?: string;
      name?: string;
      trashed?: boolean;
    };
    if (meta.trashed) {
      return NextResponse.json(
        { error: "Team folder was deleted." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      id: drive.folderId,
      name:
        typeof meta.name === "string" && meta.name ? meta.name : "Team Files",
    });
  } catch (err) {
    console.error("[drive/root]", err);
    return NextResponse.json(
      { error: "Could not load team folder." },
      { status: 502 }
    );
  }
}
