import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import {
  deleteDriveFile,
  DriveValidationError,
  getDriveAccessToken,
  verifyDriveFileInFolder,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireActiveSession, requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

/** Drive folder MIME type — a published "codebase" may be a whole tree. */
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * GET /api/projects — List projects with author metadata, newest first.
 * Supports ?limit=20&cursor=<ISO createdAt> for server-side pagination to avoid
 * loading thousands of rows into the browser when datasets grow.
 */
export async function GET(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const cursorRaw = url.searchParams.get("cursor");
  let limit = 50;
  if (limitRaw) {
    const parsed = parseInt(limitRaw, 10);
    if (Number.isFinite(parsed)) limit = Math.min(100, Math.max(1, parsed));
  }
  let cursorDate: Date | null = null;
  if (cursorRaw) {
    const d = new Date(cursorRaw);
    if (!isNaN(d.getTime())) cursorDate = d;
  }

  try {
    let rows;
    if (cursorDate) {
      const { lt } = await import("drizzle-orm");
      rows = await db
        .select({
          id: projects.id,
          title: projects.title,
          description: projects.description,
          codebaseDriveId: projects.codebaseDriveId,
          codebaseFileName: projects.codebaseFileName,
          codebaseFileSize: projects.codebaseFileSize,
          previewDriveId: projects.previewDriveId,
          previewFileName: projects.previewFileName,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          userId: projects.userId,
          userEmail: users.email,
          userRole: users.role,
          userDisplayName: users.displayName,
          userAvatarDriveId: users.avatarDriveId,
        })
        .from(projects)
        .innerJoin(users, eq(projects.userId, users.id))
        .where(lt(projects.createdAt, cursorDate))
        .orderBy(desc(projects.createdAt))
        .limit(limit + 1);
    } else {
      rows = await db
        .select({
          id: projects.id,
          title: projects.title,
          description: projects.description,
          codebaseDriveId: projects.codebaseDriveId,
          codebaseFileName: projects.codebaseFileName,
          codebaseFileSize: projects.codebaseFileSize,
          previewDriveId: projects.previewDriveId,
          previewFileName: projects.previewFileName,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          userId: projects.userId,
          userEmail: users.email,
          userRole: users.role,
          userDisplayName: users.displayName,
          userAvatarDriveId: users.avatarDriveId,
        })
        .from(projects)
        .innerJoin(users, eq(projects.userId, users.id))
        .orderBy(desc(projects.createdAt))
        .limit(limit + 1);
    }

    const hasMore = rows.length > limit;
    const slice: typeof rows = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      projects: slice.map((r: any) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      hasMore,
      nextCursor: hasMore ? (slice[slice.length - 1] as any).createdAt.toISOString() : null,
    });
  } catch (err) {
    console.error("[GET /api/projects]", err);
    return NextResponse.json(
      { error: "Failed to fetch projects." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects — record a new project bundle whose files are ALREADY
 * in Drive. File bytes travel browser→Google directly via resumable
 * sessions (POST /api/drive/upload-session); this route only records.
 *
 * Body (JSON): { title, description,
 *   codebase: { driveFileId: string },
 *   preview?: { driveFileId: string } }
 *
 * The codebase may be a single file OR a whole folder tree (the top-level
 * subfolder created inside the locked root by a folder upload). Folder
 * lock, enforced server-side: every driveFileId is re-read and REFUSED
 * unless it sits inside GOOGLE_DRIVE_UPLOAD_FOLDER_ID — this holds for
 * subfolders too, since their parent chain starts at the locked root.
 * Filenames stored are Drive's own truth, not client claims (folder
 * projects store the Drive folder name with a trailing "/"). Any file
 * type Drive supports is accepted.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveSession();
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
      {
        error:
          "Invalid JSON. Send { title, description, codebase: { driveFileId }, preview?: { driveFileId } }.",
      },
      { status: 400 }
    );
  }

  const { title, description, codebase, preview } = (body ?? {}) as {
    title?: unknown;
    description?: unknown;
    codebase?: { driveFileId?: unknown };
    preview?: { driveFileId?: unknown };
  };

  if (typeof title !== "string" || !title.trim() || title.trim().length > 100) {
    return NextResponse.json(
      { error: "Project title is required (max 100 characters)." },
      { status: 400 }
    );
  }
  if (
    typeof description !== "string" ||
    !description.trim() ||
    description.trim().length > 1000
  ) {
    return NextResponse.json(
      { error: "Project description is required (max 1000 characters)." },
      { status: 400 }
    );
  }
  const codebaseId =
    codebase && typeof codebase.driveFileId === "string"
      ? codebase.driveFileId
      : "";
  if (!codebaseId) {
    return NextResponse.json(
      { error: "An uploaded project file is required." },
      { status: 400 }
    );
  }
  const previewId =
    preview && typeof preview.driveFileId === "string"
      ? preview.driveFileId
      : null;

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );

    // 1. Verify the project file sits strictly in the pre-assigned folder
    const codebaseFile = await verifyDriveFileInFolder(
      accessToken,
      codebaseId,
      drive.folderId
    );

    // 2. Verify the optional preview the same way
    let previewDriveId: string | null = null;
    let previewFileName: string | null = null;
    if (previewId) {
      const previewFile = await verifyDriveFileInFolder(
        accessToken,
        previewId,
        drive.folderId
      );
      previewDriveId = previewFile.id;
      previewFileName = previewFile.name;
    }

    // 3. Save Project in DB (Drive's names/sizes, not client claims).
    // A folder codebase (whole uploaded tree) stores the Drive folder name
    // with a trailing "/" so cards render it as a folder project.
    const codebaseIsFolder = codebaseFile.mimeType === DRIVE_FOLDER_MIME;
    const [inserted] = await db
      .insert(projects)
      .values({
        userId: user.id,
        title: title.trim(),
        description: description.trim(),
        codebaseDriveId: codebaseFile.id,
        codebaseFileName: codebaseIsFolder
          ? `${codebaseFile.name}/`
          : codebaseFile.name,
        codebaseFileSize: codebaseIsFolder
          ? "Folder"
          : formatFileSize(Number(codebaseFile.size) || 0),
        previewDriveId,
        previewFileName,
      })
      .returning();

    console.log(
      `[POST /api/projects] Created project "${title.trim()}" id=${inserted.id} by (${user.email})`
    );

    return NextResponse.json(
      {
        project: {
          ...inserted,
          createdAt: inserted.createdAt.toISOString(),
          updatedAt: inserted.updatedAt.toISOString(),
          userEmail: user.email,
          userRole: user.role,
          userDisplayName: user.displayName ?? null,
          userAvatarDriveId: user.avatarDriveId ?? null,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DriveValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/projects] Drive or DB error:", err);
    return NextResponse.json(
      { error: "Failed to publish project. Please try again." },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/projects?id=<projectId> — Delete a project and its Drive files.
 */
export async function DELETE(req: NextRequest) {
  const user = await requireActiveSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Project id is required." },
      { status: 400 }
    );
  }

  try {
    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Only the author or an admin can delete a project
    if (existing.userId !== user.id && user.role !== "admin") {
      return NextResponse.json(
        { error: "You are not authorized to delete this project." },
        { status: 403 }
      );
    }

    // Delete files from Google Drive
    try {
      const drive = assertDriveEnv();
      const accessToken = await getDriveAccessToken(
        drive.clientId,
        drive.clientSecret,
        drive.refreshToken
      );
      if (existing.codebaseDriveId) {
        await deleteDriveFile(accessToken, existing.codebaseDriveId).catch((err) =>
          console.warn(`[DELETE /api/projects] Failed to delete codebase ${existing.codebaseDriveId}:`, err)
        );
      }
      if (existing.previewDriveId) {
        await deleteDriveFile(accessToken, existing.previewDriveId).catch((err) =>
          console.warn(`[DELETE /api/projects] Failed to delete preview ${existing.previewDriveId}:`, err)
        );
      }
    } catch (driveErr) {
      console.warn("[DELETE /api/projects] Drive cleanup warning:", driveErr);
    }

    // Delete row from DB
    await db.delete(projects).where(eq(projects.id, id));

    console.log(`[DELETE /api/projects] Deleted project id=${id} by (${user.email})`);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[DELETE /api/projects]", err);
    return NextResponse.json(
      { error: "Failed to delete project." },
      { status: 500 }
    );
  }
}
