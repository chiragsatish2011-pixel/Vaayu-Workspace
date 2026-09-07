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
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  deletedAt: string | null; // ISO timestamp or null
}

export interface CheckpointActor {
  id: string;
  email: string;
  role: "admin" | "member";
}

/** The sheet's first row must be exactly this header — else fail loudly. */
export function headerMatches(firstRow: string[] | undefined): boolean {
  if (!firstRow || firstRow.length < CHECKPOINTS_HEADER.length) return false;
  return CHECKPOINTS_HEADER.every((col, i) => firstRow[i] === col);
}

/**
 * Parse one sheet row into a record. Returns null for malformed/partial rows
 * (missing id) so callers skip them instead of surfacing corrupt data.
 */
export function parseCheckpointRow(row: string[]): CheckpointRecord | null {
  const cells = [...row];
  while (cells.length < CHECKPOINTS_HEADER.length) cells.push("");
  const [id, note, userId, userEmail, rawRole, createdAt, updatedAt, rawDeleted] =
    cells.map((c) => (c ?? "").trim());
  if (!id) return null;
  return {
    id,
    note,
    userId,
    userEmail,
    userRole: rawRole === "admin" ? "admin" : "member",
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
