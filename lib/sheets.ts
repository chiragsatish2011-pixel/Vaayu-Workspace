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

export interface SheetsMetadata {
  spreadsheetId: string;
  title: string | null;
  url: string | null;
  tabTitles: string[];
}

/** Lightweight metadata: title, URL, and tab names (for health checks). */
export async function sheetsGetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SheetsMetadata> {
  const data = (await sheetsFetch(
    accessToken,
    "get spreadsheet",
    `/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`
  )) as {
    spreadsheetId?: unknown;
    spreadsheetUrl?: unknown;
    properties?: { title?: unknown };
    sheets?: { properties?: { title?: unknown } }[];
  };
  return {
    spreadsheetId:
      typeof data?.spreadsheetId === "string"
        ? data.spreadsheetId
        : spreadsheetId,
    title:
      typeof data?.properties?.title === "string"
        ? data.properties.title
        : null,
    url:
      typeof data?.spreadsheetUrl === "string"
        ? data.spreadsheetUrl
        : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    tabTitles: Array.isArray(data?.sheets)
      ? data.sheets
          .map((s) => s?.properties?.title)
          .filter((t): t is string => typeof t === "string")
      : [],
  };
}

/** Create a brand-new spreadsheet containing exactly one tab. */
export async function sheetsCreateSpreadsheet(
  accessToken: string,
  title: string,
  tabTitle: string
): Promise<SheetsMetadata> {
  const data = (await sheetsFetch(accessToken, "create spreadsheet", "", {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: tabTitle } }],
    }),
  })) as {
    spreadsheetId?: unknown;
    spreadsheetUrl?: unknown;
    properties?: { title?: unknown };
    sheets?: { properties?: { title?: unknown } }[];
  };
  if (typeof data?.spreadsheetId !== "string") {
    throw new Error(
      "[sheets] create spreadsheet failed: no spreadsheet ID returned."
    );
  }
  return {
    spreadsheetId: data.spreadsheetId,
    title:
      typeof data?.properties?.title === "string"
        ? data.properties.title
        : title,
    url:
      typeof data?.spreadsheetUrl === "string"
        ? data.spreadsheetUrl
        : `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    tabTitles: Array.isArray(data?.sheets)
      ? data.sheets
          .map((s) => s?.properties?.title)
          .filter((t): t is string => typeof t === "string")
      : [tabTitle],
  };
}

/** Add a missing tab (idempotent callers check tabTitles first). */
export async function sheetsAddTab(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `add tab ${tabTitle}`,
    `/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: tabTitle } } }],
      }),
    }
  );
}

/** Overwrite row 1 of a tab with the exact header (data rows untouched). */
export async function sheetsWriteHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  header: string[]
): Promise<void> {
  await sheetsUpdateRow(
    accessToken,
    spreadsheetId,
    `${tabTitle}!A1:H1`,
    header
  );
}

/**
 * Translate a raw Sheets throw into an actionable setup error. Returns null
 * when the error is unrecognized (caller rethrows the original).
 */
export function sheetsSetupError(err: unknown): Error | null {
  const text = err instanceof Error ? err.message : "";
  const status = text.match(/\(HTTP (\d{3})\)/)?.[1] ?? "";
  if (/insufficient authentication scopes|insufficient permission/i.test(text)) {
    return new Error(
      "Google hasn't granted the Sheets permission yet. Run Admin → Drive setup → “Re-authorize with Google”, save the new refresh token, then try again."
    );
  }
  if (/has not been used in project|is disabled|API.*not enabled/i.test(text)) {
    return new Error(
      "The Google Sheets API isn't enabled in your Google Cloud project. Enable “Google Sheets API” (APIs & Services → Library), then try again."
    );
  }
  if (status === "404") {
    return new Error(
      "No spreadsheet exists at the configured ID — it is wrong or was deleted."
    );
  }
  return null;
}
