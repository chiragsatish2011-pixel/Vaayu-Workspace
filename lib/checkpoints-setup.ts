/**
 * Checkpoints sheet setup + health (SERVER ONLY — never import from client).
 *
 * Powers the automatic path of Admin → Drive setup: instead of hand-creating
 * a spreadsheet and pasting its ID, an admin clicks once and this module
 * verifies-or-creates everything the store needs (spreadsheet + EXACT
 * "Checkpoints" tab + exact A1:H header). Idempotent — re-running detects
 * the healthy sheet and changes nothing (never duplicates, never touches
 * data rows).
 *
 * Same owner OAuth credentials as everything else (getSheetsAccessToken —
 * NO second auth setup). Never touches GOOGLE_DRIVE_UPLOAD_FOLDER_ID: the
 * Drive file-upload feature is fully independent of this fix.
 */

import {
  CHECKPOINTS_HEADER,
  CHECKPOINTS_TAB,
  headerMatches,
} from "@/lib/checkpoints-sheet-schema";
import {
  getSheetsAccessToken,
  sheetsAddTab,
  sheetsCreateSpreadsheet,
  sheetsGetMetadata,
  sheetsGetValues,
  sheetsSetupError,
  sheetsWriteHeaderRow,
  type SheetsMetadata,
} from "@/lib/sheets";

/** Title for app-created Checkpoints spreadsheets (also the reuse key). */
export const CHECKPOINTS_SHEET_TITLE = "Vaayu Checkpoints";

export const CHECKPOINTS_SHEET_ENV_VAR = "GOOGLE_SHEETS_CHECKPOINTS_ID";

/** Configured ID, or null when unset/blank/placeholder. */
export function configuredSpreadsheetId(): string | null {
  const v = process.env.GOOGLE_SHEETS_CHECKPOINTS_ID;
  if (!v || !v.trim() || v.trim().startsWith("build-phase-placeholder")) {
    return null;
  }
  return v.trim();
}

export interface CheckpointsSheetHealth {
  /** An ID is configured (vs. missing entirely). */
  configured: boolean;
  spreadsheetId: string | null;
  /** The spreadsheet resolves via the API (not a stale/wrong ID). */
  resolves: boolean;
  title: string | null;
  url: string | null;
  tabExists: boolean;
  headersMatch: boolean;
  /** All green — Checkpoints reads/writes will work. */
  ready: boolean;
  /** Actionable setup error when not ready (null while/after healthy). */
  error: string | null;
}

function httpStatus(err: unknown): string {
  const text = err instanceof Error ? err.message : "";
  return text.match(/\(HTTP (\d{3})\)/)?.[1] ?? "";
}

async function readFirstRow(
  accessToken: string,
  spreadsheetId: string
): Promise<string[]> {
  const values = await sheetsGetValues(
    accessToken,
    spreadsheetId,
    `${CHECKPOINTS_TAB}!A1:H1`
  );
  return values[0] ?? [];
}

/**
 * Admin diagnostics: does the configured spreadsheet actually resolve, with
 * the right tab and headers? Never throws for misconfiguration — returns
 * the failure as data so the setup page can render it immediately instead
 * of surfacing later as a 404 deep in checkpoint creation.
 */
export async function getCheckpointsSheetHealth(): Promise<CheckpointsSheetHealth> {
  const base = {
    configured: false,
    spreadsheetId: null as string | null,
    resolves: false,
    title: null as string | null,
    url: null as string | null,
    tabExists: false,
    headersMatch: false,
    ready: false,
    error: null as string | null,
  };
  let accessToken: string;
  try {
    accessToken = await getSheetsAccessToken();
  } catch (err) {
    const mapped = sheetsSetupError(err);
    return {
      ...base,
      error: mapped
        ? mapped.message
        : err instanceof Error
          ? err.message
          : "Could not reach Google.",
    };
  }

  const id = configuredSpreadsheetId();
  if (!id) {
    return {
      ...base,
      error: `No checkpoints spreadsheet is wired up yet (${CHECKPOINTS_SHEET_ENV_VAR} is empty). Create one with the button below, then save its ID.`,
    };
  }

  let meta: SheetsMetadata;
  try {
    meta = await sheetsGetMetadata(accessToken, id);
  } catch (err) {
    const mapped = sheetsSetupError(err);
    return {
      ...base,
      configured: true,
      spreadsheetId: id,
      error: mapped
        ? mapped.message
        : err instanceof Error
          ? err.message
          : "Spreadsheet lookup failed.",
    };
  }

  const tabExists = meta.tabTitles.includes(CHECKPOINTS_TAB);
  let headersMatch = false;
  if (tabExists) {
    try {
      headersMatch = headerMatches(await readFirstRow(accessToken, id));
    } catch (err) {
      return {
        ...base,
        configured: true,
        spreadsheetId: id,
        resolves: true,
        title: meta.title,
        url: meta.url,
        tabExists,
        error: err instanceof Error ? err.message : "Header read failed.",
      };
    }
  }
  const ready = tabExists && headersMatch;
  return {
    configured: true,
    spreadsheetId: id,
    resolves: true,
    title: meta.title,
    url: meta.url,
    tabExists,
    headersMatch,
    ready,
    error: ready
      ? null
      : !tabExists
        ? `The spreadsheet exists but has no tab named “${CHECKPOINTS_TAB}”. Repair it with the button below.`
        : `Row 1 of the “${CHECKPOINTS_TAB}” tab must be exactly: ${CHECKPOINTS_HEADER.join(" | ")}. Repair it with the button below.`,
  };
}

export interface EnsureCheckpointsSheetResult {
  spreadsheetId: string;
  url: string;
  /** A brand-new spreadsheet was created. */
  created: boolean;
  /** An existing app-created spreadsheet was found and reused. */
  reusedExisting: boolean;
  repairedTab: boolean;
  repairedHeaders: boolean;
  /** True when the healthy ID isn't the configured one — save it to env. */
  needsEnvSave: boolean;
}

/**
 * Find spreadsheets the APP created (drive.file scope only sees those) with
 * our title, newest first — the reuse key that keeps this idempotent even
 * before any ID is saved to env.
 */
async function findAppSpreadsheetIds(
  accessToken: string
): Promise<string[]> {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.spreadsheet' and name = '${CHECKPOINTS_SHEET_TITLE}' and trashed = false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=modifiedTime desc&pageSize=10`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const data = (await res.json().catch(() => null)) as {
    files?: { id?: unknown }[];
  } | null;
  if (!res.ok) return [];
  return (data?.files ?? [])
    .map((f) => f?.id)
    .filter((id): id is string => typeof id === "string");
}

async function repairTabAndHeaders(
  accessToken: string,
  spreadsheetId: string
): Promise<{ repairedTab: boolean; repairedHeaders: boolean }> {
  let repairedTab = false;
  let repairedHeaders = false;
  const meta = await sheetsGetMetadata(accessToken, spreadsheetId);
  if (!meta.tabTitles.includes(CHECKPOINTS_TAB)) {
    await sheetsAddTab(accessToken, spreadsheetId, CHECKPOINTS_TAB);
    repairedTab = true;
  }
  if (!headerMatches(await readFirstRow(accessToken, spreadsheetId))) {
    await sheetsWriteHeaderRow(accessToken, spreadsheetId, CHECKPOINTS_TAB, [
      ...CHECKPOINTS_HEADER,
    ]);
    repairedHeaders = true;
  }
  return { repairedTab, repairedHeaders };
}

/** Throw the actionable setup error for a raw Sheets/OAuth throw. */
function failWithSetupError(err: unknown): never {
  const mapped = sheetsSetupError(err);
  if (mapped) throw mapped;
  throw err;
}

/**
 * Verify-or-create the Checkpoints sheet (admin-triggered). Idempotent:
 * a healthy sheet is returned untouched; a missing tab/bad header is
 * repaired in place; a stale/missing ID resolves to an existing
 * app-created spreadsheet when one is found, else a fresh spreadsheet is
 * created. Data rows are never touched — only the tab + row 1.
 */
export async function ensureCheckpointsSheet(): Promise<EnsureCheckpointsSheetResult> {
  let accessToken: string;
  try {
    accessToken = await getSheetsAccessToken();
  } catch (err) {
    failWithSetupError(err);
  }

  const configuredId = configuredSpreadsheetId();
  if (configuredId) {
    try {
      const meta = await sheetsGetMetadata(accessToken, configuredId);
      const { repairedTab, repairedHeaders } = await repairTabAndHeaders(
        accessToken,
        configuredId
      );
      return {
        spreadsheetId: configuredId,
        url:
          meta.url ??
          `https://docs.google.com/spreadsheets/d/${configuredId}/edit`,
        created: false,
        reusedExisting: false,
        repairedTab,
        repairedHeaders,
        needsEnvSave: false,
      };
    } catch (err) {
      // Stale/wrong ID → fall through to find-or-create. Auth/API failures
      // (403/401/5xx) must NOT silently create a second sheet — fail loudly.
      const status = httpStatus(err);
      if (status !== "404") failWithSetupError(err);
    }
  }

  // Reuse an existing app-created sheet when one resolves healthy/repairable.
  for (const candidate of await findAppSpreadsheetIds(accessToken)) {
    try {
      const { repairedTab, repairedHeaders } = await repairTabAndHeaders(
        accessToken,
        candidate
      );
      const meta = await sheetsGetMetadata(accessToken, candidate);
      return {
        spreadsheetId: candidate,
        url:
          meta.url ?? `https://docs.google.com/spreadsheets/d/${candidate}/edit`,
        created: false,
        reusedExisting: true,
        repairedTab,
        repairedHeaders,
        needsEnvSave: candidate !== configuredId,
      };
    } catch {
      // Not usable (deleted mid-flight, no access) — try the next candidate.
    }
  }

  try {
    const created = await sheetsCreateSpreadsheet(
      accessToken,
      CHECKPOINTS_SHEET_TITLE,
      CHECKPOINTS_TAB
    );
    const { repairedHeaders } = await repairTabAndHeaders(
      accessToken,
      created.spreadsheetId
    );
    return {
      spreadsheetId: created.spreadsheetId,
      url: created.url ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
      created: true,
      reusedExisting: false,
      repairedTab: false,
      repairedHeaders,
      needsEnvSave: true,
    };
  } catch (err) {
    failWithSetupError(err);
  }
}
