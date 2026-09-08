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
  const isLegacy = CHECKPOINTS_HEADER_LEGACY.every((col, i) => firstRow[i] === col);
  return isLegacy;
}

/**
 * Parse one sheet row into a record. Returns null for malformed/partial rows
 * (missing id) so callers skip them instead of surfacing corrupt data.
 */
export function parseCheckpointRow(row: string[]): CheckpointRecord | null {
  const rawLen = row.length;
  const cells = [...row];
  while (cells.length < CHECKPOINTS_HEADER.length) cells.push("");
  if (rawLen === 8) {
    // Legacy 8-col row (no display_name)
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
    };
  }
  const [id, note, userId, userEmail, rawRole, displayName, createdAt, updatedAt, rawDeleted] = cells
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
  ];
}

export function isCheckpointDeleted(record: CheckpointRecord): boolean {
  return record.deletedAt !== null && record.deletedAt.length > 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}
