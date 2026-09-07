/**
 * Google Sheets REST client (SERVER ONLY — never import from client code).
 *
 * This is NOT a second auth setup: it reuses the EXACT same owner OAuth
 * credentials and token-exchange pattern as the Drive backend (lib/drive.ts)
 * — same Google Cloud OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET),
 * same refresh token (GOOGLE_DRIVE_REFRESH_TOKEN), same
 * getDriveAccessToken() exchange. The only addition is the `spreadsheets`
 * OAuth scope, granted at the same one-time consent (Admin → Drive setup).
 *
 * Calls use plain `fetch` against the Sheets v4 API — no googleapis
 * dependency, mirroring lib/drive.ts. All writes use valueInputOption=RAW so
 * Sheets never reinterprets our ISO timestamps or note text.
 */

import { getDriveAccessToken } from "@/lib/drive";
import { assertGoogleOAuthEnv } from "@/lib/env";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function sheetsError(action: string, status: number, body: string): Error {
  // Log status + Google's error summary, never tokens.
  let hint = "";
  if (status === 401 || status === 403) {
    hint =
      " If Google reports insufficient permission, re-run Admin → Drive setup " +
      "so the refresh token includes the Sheets permission. If it reports the " +
      "API is not enabled, enable “Google Sheets API” in the same Google Cloud project.";
  }
  return new Error(
    `[sheets] ${action} failed (HTTP ${status}): ${body.slice(0, 300)}.${hint}`
  );
}

async function sheetsFetch(
  accessToken: string,
  action: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const res = await fetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  if (!res.ok) {
    throw sheetsError(
      action,
      res.status,
      typeof data?.error?.message === "string"
        ? data.error.message
        : "unknown Sheets API error"
    );
  }
  return data;
}

/**
 * Mint a short-lived Sheets-capable access token from the owner credentials.
 *
 * Uses ONLY the shared OAuth env (client ID/secret + refresh token). Never
 * touches GOOGLE_DRIVE_UPLOAD_FOLDER_ID — that ID belongs solely to the
 * Drive file-upload feature and must not block Checkpoints.
 */
export async function getSheetsAccessToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = assertGoogleOAuthEnv();
  return getDriveAccessToken(clientId, clientSecret, refreshToken);
}

/** Read a range as rows of cell strings (missing trailing cells omitted). */
export async function sheetsGetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const data = (await sheetsFetch(
    accessToken,
    `read ${range}`,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  )) as { values?: unknown };
  if (!Array.isArray(data?.values)) return [];
  return (data.values as unknown[]).map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []
  );
}

/**
 * Append ONE complete row (atomic: the full row lands or nothing does —
 * never a blank/partial row). Tab must already exist.
 */
export async function sheetsAppendRow(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  row: string[]
): Promise<void> {
  await sheetsFetch(
    accessToken,
    "append row",
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      `${tab}!A:H`
    )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) }
  );
}

/** Overwrite ONE complete row in place (update-in-place, never duplicates). */
export async function sheetsUpdateRow(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  row: string[]
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `update ${range}`,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range
    )}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [row] }) }
  );
}
