/**
 * Checkpoints sheet schema + pure row mapping.
 *
 * Zero imports on purpose: this module is unit-testable in isolation
 * (node can run it directly via type-stripping). All Sheets/network code
 * lives in lib/checkpoints-store.ts, which builds on these helpers.
 *
 * Columns mirror the app's real checkpoint model (note + author +
 * timestamps) plus the operational columns update/soft-delete need:
 *
 *   id | note | user_id | user_email | user_role | created_at | updated_at | deleted_at
 *
 * Soft-delete (the team's chosen delete semantics): DELETE sets deleted_at;
 * reads exclude deleted rows, so the app never shows them while the sheet
 * keeps the history.
 */

export const CHECKPOINTS_TAB = "Checkpoints";

export const CHECKPOINTS_HEADER = [
  "id",
  "note",
  "user_id",
  "user_email",
  "user_role",
  "display_name",
  "created_at",
  "updated_at",
  "deleted_at",
  "content_json",
] as const;

// Old 8-col header (pre-displayName) — still accepted for backwards compat
export const CHECKPOINTS_HEADER_LEGACY = [
  "id",
  "note",
  "user_id",
  "user_email",
  "user_role",
  "created_at",
  "updated_at",
  "deleted_at",
] as const;

export interface CheckpointRecord {
  id: string;
  note: string;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  deletedAt: string | null; // ISO timestamp or null
  contentJson?: string | null; // Tiptap JSON for mentions — plain note stays readable in Sheet
}

export interface CheckpointActor {
  id: string;
  email: string;
  role: "admin" | "member";
  displayName?: string | null;
}

/** The sheet's first row must be exactly the current or legacy header — else fail loudly. */
export function headerMatches(firstRow: string[] | undefined): boolean {
  if (!firstRow) return false;
  const isCurrent = CHECKPOINTS_HEADER.every((col, i) => firstRow[i] === col);
  if (isCurrent) return true;
  // Accept 9-col header (pre-content_json) as current for backwards compat — content_json is optional last column
  const nineHeader = CHECKPOINTS_HEADER.slice(0, 9);
  const isNine = nineHeader.every((col, i) => firstRow[i] === col) && (firstRow.length === 9 || firstRow[9] === undefined || firstRow[9] === "content_json");
  if (isNine) return true;
  const isLegacy = CHECKPOINTS_HEADER_LEGACY.every((col, i) => firstRow[i] === col);
  return isLegacy;
}

/**
 * Parse one sheet row into a record. Returns null for malformed/partial rows
 * (missing id) so callers skip them instead of surfacing corrupt data.
 */
function isIsoTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
}

export function parseCheckpointRow(row: string[]): CheckpointRecord | null {
  const cells = [...row];
  while (cells.length < CHECKPOINTS_HEADER.length) cells.push("");
  const rawLen = row.length;
  // Distinguish legacy 8-col vs current 9/10-col rows robustly:
  // - Legacy: index 5 is createdAt (ISO), index 6 updatedAt (ISO)
  // - Current: index 5 is displayName (not ISO, often ""), index 6 createdAt (ISO)
  // Sheets API omits trailing empty cells, so a current row with empty
  // displayName and empty deleted_at appears as 8 cells but with "" at 5.
  // We use ISO heuristic, not rawLen, to avoid misclassifying.
  const maybeDisplayName = (cells[5] ?? "").trim();
  const maybeCreatedAt = (cells[6] ?? "").trim();
  const isLegacyRow = isIsoTimestamp(maybeDisplayName) && isIsoTimestamp(maybeCreatedAt);
  // Fallback: if header was legacy, all rows with 8 cells are legacy; but
  // for mixed sheets (legacy header + new 9-col rows with empty displayName
  // trimmed to 8), the ISO heuristic above correctly identifies them as
  // current (since index5 is "" not ISO).
  if (isLegacyRow || (rawLen === 8 && isIsoTimestamp((cells[5] ?? "").trim()))) {
    // Legacy 8-col row (no display_name): [id,note,userId,email,role,createdAt,updatedAt,deletedAt]
    const [id, note, userId, userEmail, rawRole, createdAt, updatedAt, rawDeleted] = cells.map((c) => (c ?? "").trim());
    if (!id) return null;
    return {
      id,
      note,
      userId,
      userEmail,
      userRole: rawRole === "admin" ? "admin" : "member",
      displayName: null,
      createdAt,
      updatedAt,
      deletedAt: rawDeleted ? rawDeleted : null,
      contentJson: null,
    };
  }
  // Current 9/10-col: [id,note,userId,email,role,displayName,createdAt,updatedAt,deletedAt,content_json?]
  const [id, note, userId, userEmail, rawRole, displayName, createdAt, updatedAt, rawDeleted, rawContentJson] = cells
    .map((c) => (c ?? "").trim());
  if (!id) return null;
  return {
    id,
    note,
    userId,
    userEmail,
    userRole: rawRole === "admin" ? "admin" : "member",
    displayName: displayName || null,
    createdAt,
    updatedAt,
    deletedAt: rawDeleted ? rawDeleted : null,
    contentJson: rawContentJson || null,
  };
}

/** Serialize a record back to a complete sheet row (never partial). */
export function toSheetRow(record: CheckpointRecord): string[] {
  return [
    record.id,
    record.note,
    record.userId,
    record.userEmail,
    record.userRole,
    record.displayName ?? "",
    record.createdAt,
    record.updatedAt,
    record.deletedAt ?? "",
    record.contentJson ?? "",
  ];
}

export function isCheckpointDeleted(record: CheckpointRecord): boolean {
  return record.deletedAt !== null && record.deletedAt.length > 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}
