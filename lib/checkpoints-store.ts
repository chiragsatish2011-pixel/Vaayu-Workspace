/**
 * Checkpoints data-access layer (SERVER ONLY).
 *
 * The "Checkpoints" Google Sheet IS the database for checkpoints:
 * every create/update/delete below reads/writes the sheet immediately via
 * lib/sheets.ts (same owner OAuth credentials as the Drive backend).
 *
 * DB-like guarantees:
 * - CREATE appends one complete row (single atomic Sheets call — full row
 *   or nothing, never blank/partial) with a UUID id.
 * - UPDATE rewrites the matched row in place by id — never a duplicate row.
 * - DELETE is a soft-delete (team decision): sets deleted_at in place.
 *   Reads exclude deleted rows, so the app never shows them.
 * - Reads validate the header row (fail loudly on sheet misconfiguration),
 *   skip malformed rows, and dedupe by id (first occurrence wins) as a
 *   safety net — the sheet can never surface corrupt/duplicate data.
 * - Reads are cheap: one values.get per call, plus a short (15s) in-memory
 *   TTL cache invalidated on every write.
 *
 * Auth (Neon/Postgres) is untouched: user identity/roles still come from
 * the session; the sheet stores the author's snapshot for display.
 */

import { randomUUID } from "node:crypto";
import {
  CHECKPOINTS_HEADER,
  CHECKPOINTS_TAB,
  headerMatches,
  isCheckpointDeleted,
  nowIso,
  parseCheckpointRow,
  toSheetRow,
  type CheckpointActor,
  type CheckpointRecord,
} from "@/lib/checkpoints-sheet-schema";
import { requireCheckpointsSpreadsheetId } from "@/lib/env";
import {
  getSheetsAccessToken,
  sheetsAppendRow,
  sheetsGetValues,
  sheetsUpdateRow,
} from "@/lib/sheets";

export type { CheckpointActor };

export interface CheckpointView {
  id: string;
  note: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName: string | null;
  contentJson?: string | null;
}

export class CheckpointNotFoundError extends Error {
  constructor(id: string) {
    super(`Checkpoint not found: ${id}`);
    this.name = "CheckpointNotFoundError";
  }
}

export class CheckpointForbiddenError extends Error {
  constructor() {
    super("Only the author or an admin can change this checkpoint.");
    this.name = "CheckpointForbiddenError";
  }
}

interface CachedRow {
  record: CheckpointRecord;
  /** 1-based sheet row number (row 1 is the header). */
  rowNumber: number;
}

const CACHE_TTL_MS = 15_000;
let cache: { spreadsheetId: string; at: number; rows: CachedRow[] } | null =
  null;

function invalidateCache(spreadsheetId: string): void {
  if (cache?.spreadsheetId === spreadsheetId) cache = null;
}

function toView(record: CheckpointRecord): CheckpointView {
  return {
    id: record.id,
    note: record.note,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    userId: record.userId,
    userEmail: record.userEmail,
    userRole: record.userRole,
    displayName: record.displayName ?? null,
    contentJson: record.contentJson ?? null,
  };
}

/** Read the whole tab (header-validated) with row numbers attached. */
async function readSheet(): Promise<{
  spreadsheetId: string;
  rows: CachedRow[];
}> {
  const spreadsheetId = requireCheckpointsSpreadsheetId();
  const now = Date.now();
  if (
    cache &&
    cache.spreadsheetId === spreadsheetId &&
    now - cache.at < CACHE_TTL_MS
  ) {
    return { spreadsheetId, rows: cache.rows };
  }

  const token = await getSheetsAccessToken();
  let values: string[][];
  try {
    values = await sheetsGetValues(
      token,
      spreadsheetId,
      `${CHECKPOINTS_TAB}!A1:J`
    );
  } catch (err) {
    // A missing tab surfaces from the API as a 400 range error — translate
    // it into the actionable setup step instead of leaking API jargon.
    if (
      err instanceof Error &&
      /unable to parse range/i.test(err.message)
    ) {
      throw new Error(
        `Checkpoints sheet is missing the “${CHECKPOINTS_TAB}” tab. Create it with the header row (${CHECKPOINTS_HEADER.join(
          " | "
        )}) — steps live at Admin → Drive setup.`
      );
    }
    throw err;
  }

  if (!headerMatches(values[0])) {
    throw new Error(
      `Checkpoints sheet header mismatch on the “${CHECKPOINTS_TAB}” tab. Row 1 must be exactly: ${CHECKPOINTS_HEADER.join(
        " | "
      )}.`
    );
  }

  const rows: CachedRow[] = [];
  const seen = new Set<string>();
  values.slice(1).forEach((raw, index) => {
    const record = parseCheckpointRow(raw);
    if (!record || seen.has(record.id)) return; // skip partial + dupes
    seen.add(record.id);
    rows.push({ record, rowNumber: index + 2 });
  });

  cache = { spreadsheetId, at: now, rows };
  return { spreadsheetId, rows };
}

function sortNewestFirst(views: CheckpointView[]): CheckpointView[] {
  return views.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

export async function getCheckpoints(): Promise<CheckpointView[]> {
  const { rows } = await readSheet();
  return sortNewestFirst(
    rows
      .map((r) => r.record)
      .filter((record) => !isCheckpointDeleted(record))
      .map(toView)
  );
}

/** Find a LIVE (non-deleted) row by id, enforcing author-or-admin. */
function findLiveRow(
  rows: CachedRow[],
  actor: CheckpointActor,
  id: string
): CachedRow {
  const hit = rows.find((r) => r.record.id === id);
  if (!hit || isCheckpointDeleted(hit.record)) {
    throw new CheckpointNotFoundError(id);
  }
  if (hit.record.userId !== actor.id && actor.role !== "admin") {
    throw new CheckpointForbiddenError();
  }
  return hit;
}

export async function createCheckpoint(
  actor: CheckpointActor,
  note: string,
  contentJson?: string | null
): Promise<CheckpointView> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("Note content is required.");

  const spreadsheetId = requireCheckpointsSpreadsheetId();
  const token = await getSheetsAccessToken();
  const now = nowIso();
  const record: CheckpointRecord = {
    id: randomUUID(),
    note: trimmed,
    userId: actor.id,
    userEmail: actor.email,
    userRole: actor.role,
    displayName: actor.displayName ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    contentJson: contentJson ?? null,
  };
  await sheetsAppendRow(
    token,
    spreadsheetId,
    CHECKPOINTS_TAB,
    toSheetRow(record)
  );
  invalidateCache(spreadsheetId);
  return toView(record);
}

export async function updateCheckpoint(
  actor: CheckpointActor,
  id: string,
  note: string,
  contentJson?: string | null
): Promise<CheckpointView> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("Note content is required.");
  if (!id) throw new CheckpointNotFoundError("(missing id)");

  const { spreadsheetId, rows } = await readSheet();
  const hit = findLiveRow(rows, actor, id);
  hit.record.note = trimmed;
  if (contentJson !== undefined) hit.record.contentJson = contentJson;
  hit.record.updatedAt = nowIso();

  const token = await getSheetsAccessToken();
  await sheetsUpdateRow(
    token,
    spreadsheetId,
    `${CHECKPOINTS_TAB}!A${hit.rowNumber}:J${hit.rowNumber}`,
    toSheetRow(hit.record)
  );
  invalidateCache(spreadsheetId);
  return toView(hit.record);
}

/** Soft-delete: stamps deleted_at in place; reads hide the row. */
export async function deleteCheckpoint(
  actor: CheckpointActor,
  id: string
): Promise<void> {
  if (!id) throw new CheckpointNotFoundError("(missing id)");

  const { spreadsheetId, rows } = await readSheet();
  const hit = findLiveRow(rows, actor, id);
  const now = nowIso();
  hit.record.deletedAt = now;
  hit.record.updatedAt = now;

  const token = await getSheetsAccessToken();
  await sheetsUpdateRow(
    token,
    spreadsheetId,
    `${CHECKPOINTS_TAB}!A${hit.rowNumber}:I${hit.rowNumber}`,
    toSheetRow(hit.record)
  );
  invalidateCache(spreadsheetId);
}
