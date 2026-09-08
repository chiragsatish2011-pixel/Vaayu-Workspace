import "server-only";

import { CHAT_ARCHIVE_HEADER, CHAT_ARCHIVE_TAB, headerMatches, parseChatArchiveRow, toSheetRow, type ChatArchiveRecord } from "@/lib/chat-archive-schema";
import { requireCheckpointsSpreadsheetId } from "@/lib/env";
import { getSheetsAccessToken, sheetsAppendRow, sheetsGetValues, sheetsAddTab, sheetsGetMetadata, sheetsUpdateRow } from "@/lib/sheets";

interface CachedRow {
  record: ChatArchiveRecord;
  rowNumber: number;
}

const CACHE_TTL_MS = 15_000;
let cache: { spreadsheetId: string; at: number; rows: CachedRow[] } | null = null;

function invalidateCache(spreadsheetId: string): void {
  if (cache?.spreadsheetId === spreadsheetId) cache = null;
}

export async function ensureChatArchiveSheet(): Promise<void> {
  const spreadsheetId = requireCheckpointsSpreadsheetId();
  const token = await getSheetsAccessToken();
  const meta = await sheetsGetMetadata(token, spreadsheetId);
  if (!meta.tabTitles.includes(CHAT_ARCHIVE_TAB)) {
    await sheetsAddTab(token, spreadsheetId, CHAT_ARCHIVE_TAB);
    await sheetsUpdateRow(token, spreadsheetId, `${CHAT_ARCHIVE_TAB}!A1:L1`, [...CHAT_ARCHIVE_HEADER]);
    invalidateCache(spreadsheetId);
  } else {
    // Ensure header is correct
    const values = await sheetsGetValues(token, spreadsheetId, `${CHAT_ARCHIVE_TAB}!A1:L1`);
    if (!headerMatches(values[0])) {
      await sheetsUpdateRow(token, spreadsheetId, `${CHAT_ARCHIVE_TAB}!A1:L1`, [...CHAT_ARCHIVE_HEADER]);
      invalidateCache(spreadsheetId);
    }
  }
}

async function readSheet(): Promise<{ spreadsheetId: string; rows: CachedRow[] }> {
  const spreadsheetId = requireCheckpointsSpreadsheetId();
  const now = Date.now();
  if (cache && cache.spreadsheetId === spreadsheetId && now - cache.at < CACHE_TTL_MS) {
    return { spreadsheetId, rows: cache.rows };
  }
  const token = await getSheetsAccessToken();
  let values: string[][];
  try {
    values = await sheetsGetValues(token, spreadsheetId, `${CHAT_ARCHIVE_TAB}!A1:L`);
  } catch (err) {
    if (err instanceof Error && /unable to parse range/i.test(err.message)) {
      // Tab doesn't exist yet
      await ensureChatArchiveSheet();
      return { spreadsheetId, rows: [] };
    }
    throw err;
  }
  if (!headerMatches(values[0])) {
    throw new Error(`ChatArchive sheet header mismatch on the “${CHAT_ARCHIVE_TAB}” tab. Row 1 must be exactly: ${CHAT_ARCHIVE_HEADER.join(" | ")}.`);
  }
  const rows: CachedRow[] = [];
  const seen = new Set<string>();
  values.slice(1).forEach((raw, index) => {
    const record = parseChatArchiveRow(raw);
    if (!record || seen.has(record.id)) return;
    seen.add(record.id);
    rows.push({ record, rowNumber: index + 2 });
  });
  cache = { spreadsheetId, at: now, rows };
  return { spreadsheetId, rows };
}

export async function getArchivedMessages(conversationId: string): Promise<ChatArchiveRecord[]> {
  const { rows } = await readSheet();
  return rows
    .map((r) => r.record)
    .filter((rec) => rec.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function archiveMessages(records: ChatArchiveRecord[]): Promise<void> {
  if (records.length === 0) return;
  await ensureChatArchiveSheet();
  const spreadsheetId = requireCheckpointsSpreadsheetId();
  const token = await getSheetsAccessToken();
  for (const rec of records) {
    await sheetsAppendRow(token, spreadsheetId, CHAT_ARCHIVE_TAB, toSheetRow(rec));
  }
  invalidateCache(spreadsheetId);
}

export async function getAllArchivedCount(): Promise<number> {
  const { rows } = await readSheet();
  return rows.length;
}
