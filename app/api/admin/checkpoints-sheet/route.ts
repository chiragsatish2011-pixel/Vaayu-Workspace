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
  const health = await getCheckpointsSheetHealth();
  return NextResponse.json({ ...health, envVar: CHECKPOINTS_SHEET_ENV_VAR });
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
