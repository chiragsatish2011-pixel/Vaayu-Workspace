import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import {
  deleteDriveFile,
  ensureDriveFolder,
  getDriveAccessToken,
  uploadDriveFile,
  validateUpload,
} from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireActiveSession } from "@/lib/session";

export const runtime = "nodejs";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * GET /api/projects — List all projects with author metadata, newest first.
 */
export async function GET() {
  const user = await requireActiveSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const rows = await db
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
      })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .orderBy(desc(projects.createdAt));

    return NextResponse.json({
      projects: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
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
 * POST /api/projects — Create a new project bundle with Drive storage.
 * Multipart fields: { title, description, codebase: File, preview?: File }
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data submission." },
      { status: 400 }
    );
  }

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const codebaseFile = form.get("codebase");
  const previewFile = form.get("preview");

  if (!title || title.length > 100) {
    return NextResponse.json(
      { error: "Project title is required (max 100 characters)." },
      { status: 400 }
    );
  }
  if (!description || description.length > 1000) {
    return NextResponse.json(
      { error: "Project description is required (max 1000 characters)." },
      { status: 400 }
    );
  }
  if (!(codebaseFile instanceof Blob) || codebaseFile.size === 0) {
    return NextResponse.json(
      { error: "A compressed codebase archive (.zip or .tar.gz) is required." },
      { status: 400 }
    );
  }

  const codebaseOrigName =
    codebaseFile instanceof File && codebaseFile.name
      ? codebaseFile.name
      : "codebase.zip";
  const codebaseCheck = validateUpload(
    "codebase",
    codebaseOrigName,
    codebaseFile.type || "application/zip",
    codebaseFile.size
  );
  if ("error" in codebaseCheck) {
    return NextResponse.json({ error: codebaseCheck.error }, { status: 400 });
  }

  let previewSanitizedName: string | null = null;
  if (previewFile instanceof Blob && previewFile.size > 0) {
    const previewOrigName =
      previewFile instanceof File && previewFile.name
        ? previewFile.name
        : "preview.png";
    const previewCheck = validateUpload(
      "preview",
      previewOrigName,
      previewFile.type || "image/png",
      previewFile.size
    );
    if ("error" in previewCheck) {
      return NextResponse.json({ error: previewCheck.error }, { status: 400 });
    }
    previewSanitizedName = previewCheck.name;
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );
    const folderId = await ensureDriveFolder(accessToken);

    // 1. Upload codebase archive
    const codebaseUpload = await uploadDriveFile(accessToken, {
      name: codebaseCheck.name,
      mimeType: codebaseFile.type || "application/zip",
      bytes: codebaseFile,
      folderId,
    });

    // 2. Upload optional preview image
    let previewDriveId: string | null = null;
    let previewFileName: string | null = null;
    if (previewFile instanceof Blob && previewFile.size > 0 && previewSanitizedName) {
      const previewUpload = await uploadDriveFile(accessToken, {
        name: previewSanitizedName,
        mimeType: previewFile.type || "image/png",
        bytes: previewFile,
        folderId,
      });
      previewDriveId = previewUpload.id;
      previewFileName = previewUpload.name;
    }

    // 3. Save Project in DB
    const [inserted] = await db
      .insert(projects)
      .values({
        userId: user.id,
        title,
        description,
        codebaseDriveId: codebaseUpload.id,
        codebaseFileName: codebaseUpload.name,
        codebaseFileSize: formatFileSize(codebaseFile.size),
        previewDriveId,
        previewFileName,
      })
      .returning();

    console.log(
      `[POST /api/projects] Created project "${title}" id=${inserted.id} by (${user.email})`
    );

    return NextResponse.json(
      {
        project: {
          ...inserted,
          createdAt: inserted.createdAt.toISOString(),
          updatedAt: inserted.updatedAt.toISOString(),
          userEmail: user.email,
          userRole: user.role,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/projects] Drive or DB error:", err);
    return NextResponse.json(
      { error: "Failed to upload project to Drive. Please try again." },
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
