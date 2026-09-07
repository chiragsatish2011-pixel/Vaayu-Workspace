import { NextResponse } from "next/server";
import {
  CHECKPOINTS_SHEET_ENV_VAR,
  ensureCheckpointsSheet,
  getCheckpointsSheetHealth,
} from "@/lib/checkpoints-setup";
import { requireApiAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/checkpoints-sheet — admin diagnostics + one-click setup for
 * the "Checkpoints" Google Sheet (the checkpoints database).
 *
 * GET: health of the currently configured spreadsheet (resolves? tab?
 * headers?) as data — never a 500 for mere misconfiguration, so the
 * setup page can show exactly what's wrong immediately.
 *
 * POST: idempotent verify-or-create — repairs/creates the spreadsheet +
 * tab + header row, never duplicates a healthy sheet, never touches data
 * rows. When the healthy ID isn't saved to env yet, the response says so
 * (the server cannot write Vercel env vars itself).
 *
 * Untouched: GOOGLE_DRIVE_UPLOAD_FOLDER_ID and every Drive upload path.
 */
export async function GET() {
  const admin = await requireApiAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  // TEMP-DEBUG (live 404 investigation — remove after): print the EXACT
  // env value the running production server sees at request time, plus
  // which deployment is serving traffic. A sheet ID is not a secret.
  const raw = process.env.GOOGLE_SHEETS_CHECKPOINTS_ID ?? null;
  const debug = {
    rawId: raw,
    rawLength: raw === null ? null : raw.length,
    trimmedLength: raw === null ? null : raw.trim().length,
    hasPadding: raw !== null && raw !== raw.trim(),
    deployment: {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      env: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_URL ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      builtAt: process.env.VERCEL_BUILD_TIME ?? null,
    },
  };
  console.log(`[checkpoints-debug] LIVE env ${JSON.stringify(debug)}`);
  // TEMP-DEBUG: Drive-side cross-check with the SAME prod token. Sheets 404
  // + Drive 200 on the same ID = visibility/scope problem (the file exists
  // but the Sheets call can't see it). Both 404 = the ID resolves nowhere.
  let driveCrossCheck: {
    status: number;
    name?: string;
    mimeType?: string;
    error?: string;
  } | null = null;
  if (raw && raw.trim()) {
    try {
      const { getSheetsAccessToken } = await import("@/lib/sheets");
      const token = await getSheetsAccessToken();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(raw.trim())}?fields=id,name,mimeType,trashed`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const body = (await res.json().catch(() => null)) as {
        name?: unknown;
        mimeType?: unknown;
        error?: { message?: unknown };
      } | null;
      driveCrossCheck = {
        status: res.status,
        ...(typeof body?.name === "string" ? { name: body.name } : {}),
        ...(typeof body?.mimeType === "string" ? { mimeType: body.mimeType } : {}),
        ...(res.ok
          ? {}
          : {
              error:
                typeof body?.error?.message === "string"
                  ? body.error.message.slice(0, 200)
                  : `HTTP ${res.status}`,
            }),
      };
    } catch (err) {
      driveCrossCheck = {
        status: 0,
        error: err instanceof Error ? err.message.slice(0, 200) : "fetch failed",
      };
    }
  }
  const health = await getCheckpointsSheetHealth();
  return NextResponse.json({
    ...health,
    envVar: CHECKPOINTS_SHEET_ENV_VAR,
    debug: { ...debug, driveCrossCheck },
  });
}

export async function POST() {
  const admin = await requireApiAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  try {
    const result = await ensureCheckpointsSheet();
    console.log(
      `[admin/checkpoints-sheet] ensured id=${result.spreadsheetId} created=${result.created} reused=${result.reusedExisting} by (${admin.email})`
    );
    return NextResponse.json({ ...result, envVar: CHECKPOINTS_SHEET_ENV_VAR });
  } catch (err) {
    console.error("[admin/checkpoints-sheet]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message
            ? err.message
            : "Could not set up the Checkpoints sheet.",
      },
      { status: 502 }
    );
  }
}
