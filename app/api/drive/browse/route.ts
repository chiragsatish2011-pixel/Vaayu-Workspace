import { NextRequest, NextResponse } from "next/server";
import {
  getDriveAccessToken,
  isDescendantOfFolder,
  isValidDriveFileId,
  listDriveFolderContents,
  listDriveTree,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/browse?id=<driveFileOrFolderId>[&fresh=1][&shallow=1]
 * Returns file browser data for a project. For a folder project (whole
 * uploaded tree), recursively lists all files/folders preserving relativePath.
 * For a single file, returns just that file's metadata.
 *
 * `fresh=1` bypasses the 30s server listing cache (still refreshes it) —
 * used after the client changed something (upload landed, trash completed)
 * so the next paint shows truth, not a stale snapshot. Default opens stay
 * cached and fast.
 *
 * `shallow=1` lists ONLY the immediate children of a folder (one cheap,
 * cached Drive call). The team Files browser pages with this — it must
 * NEVER recursively sync the whole tree, which is what made large Drives
 * slow and rate-limit-flaky. The recursive mode stays for project bundles
 * that genuinely need the full tree (zips, virtualized grids).
 *
 * Uses Drive's thumbnailLink/iconLink for fast previews (no extra fetch)
 * and paginates server-side (pageSize 1000 + nextPageToken loop) so even
 * 27k-file projects return in one response (~2-3MB JSON) — the client then
 * virtualizes rendering, so no lag. Server caches folder listings 30s.
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!isValidDriveFileId(id)) {
    return NextResponse.json({ error: "A valid Drive file/folder id is required." }, { status: 400 });
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const shallow = new URL(req.url).searchParams.get("shallow") === "1";

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );

    // Verify the requested item is inside the locked folder (or is a file directly under it)
    // Fetch its metadata first and check parents chain
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed,thumbnailLink,iconLink,modifiedTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (metaRes.status === 404) {
      return NextResponse.json({ error: "File or folder not found." }, { status: 404 });
    }
    if (!metaRes.ok) {
      const body = await metaRes.text().catch(() => "");
      throw new Error(`[drive] browse metadata failed (HTTP ${metaRes.status}): ${body.slice(0, 200)}`);
    }
    const meta = (await metaRes.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      parents?: string[];
      trashed?: boolean;
      thumbnailLink?: string;
      iconLink?: string;
      modifiedTime?: string;
    };

    if (meta.trashed) {
      return NextResponse.json({ error: "File or folder was deleted." }, { status: 404 });
    }

    const isFolder = meta.mimeType === "application/vnd.google-apps.folder";
    const isDirectChild = Array.isArray(meta.parents) && meta.parents.includes(drive.folderId);
    const isRoot = id === drive.folderId;

    // Enforce folder lock: id must be root, direct child, or descendant of locked folder.
    // This prevents IDOR browsing of arbitrary Drive files outside the team space.
    if (!isRoot && !isDirectChild) {
      const inside = await isDescendantOfFolder(accessToken, id, drive.folderId);
      if (!inside) {
        return NextResponse.json({ error: "File or folder is not inside the team folder." }, { status: 403 });
      }
    }

    if (isFolder) {
      // Shallow mode — immediate children only (team Files browser paging).
      if (shallow) {
        const children = await listDriveFolderContents(accessToken, id, { fresh });
        let totalBytes = 0;
        let fileCount = 0;
        for (const child of children) {
          if (!child.isFolder) {
            fileCount++;
            const sz = Number(child.size || 0);
            if (Number.isFinite(sz)) totalBytes += sz;
          }
        }
        return NextResponse.json({
          root: {
            id: meta.id as string,
            name: meta.name as string,
            mimeType: meta.mimeType as string,
            size: meta.size,
            modifiedTime: meta.modifiedTime,
            thumbnailLink: meta.thumbnailLink,
            iconLink: meta.iconLink,
            parents: meta.parents,
            isFolder: true,
          },
          isFolder: true,
          shallow: true,
          totalBytes,
          fileCount,
          files: children.map((child) => ({
            id: child.id,
            name: child.name,
            mimeType: child.mimeType,
            size: child.size,
            modifiedTime: child.modifiedTime,
            thumbnailLink: child.thumbnailLink,
            iconLink: child.iconLink,
            parents: child.parents,
            isFolder: child.isFolder,
            relativePath: child.name,
          })),
        });
      }
      // Folder project — recursively list all descendants
      const tree = await listDriveTree(accessToken, id, { fresh });
      // Calculate totals for client warning (e.g., 754MB across 27k files)
      let totalBytes = 0;
      let fileCount = 0;
      for (const { file } of tree) {
        if (!file.isFolder) {
          fileCount++;
          const sz = Number(file.size || 0);
          if (Number.isFinite(sz)) totalBytes += sz;
        }
      }
      // Also get top folder's own metadata for display
      const folderMeta = {
        id: meta.id as string,
        name: meta.name as string,
        mimeType: meta.mimeType as string,
        size: meta.size,
        modifiedTime: meta.modifiedTime,
        thumbnailLink: meta.thumbnailLink,
        iconLink: meta.iconLink,
        parents: meta.parents,
        isFolder: true,
      };

      return NextResponse.json({
        root: folderMeta,
        isFolder: true,
        totalBytes,
        fileCount,
        // Tree includes both files and subfolders with relativePath
        files: tree.map(({ file, relativePath }) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          modifiedTime: file.modifiedTime,
          thumbnailLink: file.thumbnailLink,
          iconLink: file.iconLink,
          parents: file.parents,
          isFolder: file.isFolder,
          relativePath,
        })),
      });
    } else {
      // Single file project — return just that file
      const fileCount = 1;
      const totalBytes = Number(meta.size || 0) || 0;
      return NextResponse.json({
        root: {
          id: meta.id as string,
          name: meta.name as string,
          mimeType: meta.mimeType as string,
          size: meta.size,
          modifiedTime: meta.modifiedTime,
          thumbnailLink: meta.thumbnailLink,
          iconLink: meta.iconLink,
          parents: meta.parents,
          isFolder: false,
        },
        isFolder: false,
        totalBytes,
        fileCount,
        files: [
          {
            id: meta.id as string,
            name: meta.name as string,
            mimeType: meta.mimeType as string,
            size: meta.size,
            modifiedTime: meta.modifiedTime,
            thumbnailLink: meta.thumbnailLink,
            iconLink: meta.iconLink,
            parents: meta.parents,
            isFolder: false,
            relativePath: meta.name as string,
          },
        ],
      });
    }
  } catch (err) {
    console.error("[drive/browse]", err);
    return NextResponse.json(
      { error: "Could not browse Drive folder. Please try again." },
      { status: 502 }
    );
  }
}
