import { NextRequest, NextResponse } from "next/server";
import {
  downloadDriveFile,
  getDriveAccessToken,
  isDescendantOfFolder,
  isValidDriveFileId,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/drive/download?id=<driveFileId> — streams the file back as an
 * attachment. Metadata is fetched first for a clean 404 and safe headers.
 * Google credentials stay server-side; only bytes flow to the browser.
 */
export async function GET(req: NextRequest) {
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

  if (id === drive.folderId) {
    return NextResponse.json({ error: "Cannot download the team folder itself — zip it instead." }, { status: 400 });
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );

    const inside = await isDescendantOfFolder(accessToken, id, drive.folderId);
    if (!inside) {
      return NextResponse.json({ error: "File is not inside the team folder." }, { status: 403 });
    }

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (metaRes.status === 404) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    if (!metaRes.ok) {
      throw new Error(`[drive] metadata fetch failed (HTTP ${metaRes.status})`);
    }
    const meta = (await metaRes.json()) as {
      name?: string;
      mimeType?: string;
      size?: string;
    };

    // Folder projects (whole uploaded trees) cannot stream as one file —
    // say so clearly instead of proxying a confusing Google error.
    if (meta.mimeType === "application/vnd.google-apps.folder") {
      return NextResponse.json(
        {
          error:
            "This project is a folder in Google Drive, not a single file — browse its files directly in Drive.",
        },
        { status: 400 }
      );
    }

    const upstream = await downloadDriveFile(accessToken, id);
    if (upstream.status === 404) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    if (!upstream.ok || !upstream.body) {
      throw new Error(
        `[drive] download failed (HTTP ${upstream.status})`
      );
    }

    const safeName = (meta.name ?? "download").replace(/["\r\n]/g, "");
    console.log(`[drive/download] (${safeName}) by (${user.email})`);
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": meta.mimeType ?? "application/octet-stream",
        ...(meta.size ? { "Content-Length": meta.size } : {}),
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  } catch (err) {
    console.error("[drive/download]", err);
    return NextResponse.json(
      { error: "Drive download failed. Please try again." },
      { status: 502 }
    );
  }
}
