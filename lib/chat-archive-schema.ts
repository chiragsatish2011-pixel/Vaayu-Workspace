/**
 * ChatArchive sheet schema — mirrors chat_messages table for archival.
 * Messages older than 24h are moved from Neon to this sheet to keep Neon free.
 */

export const CHAT_ARCHIVE_TAB = "ChatArchive";

export const CHAT_ARCHIVE_HEADER = [
  "id",
  "conversation_id",
  "user_id",
  "user_email",
  "user_role",
  "display_name",
  "avatar_drive_id",
  "content",
  "content_json",
  "created_at",
  "updated_at",
  "archived_at",
] as const;

export interface ChatArchiveRecord {
  id: string;
  conversationId: string;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
  displayName: string | null;
  avatarDriveId: string | null;
  content: string;
  contentJson: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
}

export function headerMatches(firstRow: string[] | undefined): boolean {
  if (!firstRow) return false;
  return CHAT_ARCHIVE_HEADER.every((col, i) => firstRow[i] === col);
}

export function parseChatArchiveRow(row: string[]): ChatArchiveRecord | null {
  const cells = [...row];
  while (cells.length < CHAT_ARCHIVE_HEADER.length) cells.push("");
  const [id, conversationId, userId, userEmail, rawRole, displayName, avatarDriveId, content, contentJson, createdAt, updatedAt, archivedAt] = cells.map((c) => (c ?? "").trim());
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    userId,
    userEmail,
    userRole: rawRole === "admin" ? "admin" : "member",
    displayName: displayName || null,
    avatarDriveId: avatarDriveId || null,
    content,
    contentJson: contentJson || null,
    createdAt,
    updatedAt,
    archivedAt: archivedAt || new Date().toISOString(),
  };
}

export function toSheetRow(record: ChatArchiveRecord): string[] {
  return [
    record.id,
    record.conversationId,
    record.userId,
    record.userEmail,
    record.userRole,
    record.displayName ?? "",
    record.avatarDriveId ?? "",
    record.content,
    record.contentJson ?? "",
    record.createdAt,
    record.updatedAt,
    record.archivedAt,
  ];
}

export function nowIso(): string {
  return new Date().toISOString();
}
