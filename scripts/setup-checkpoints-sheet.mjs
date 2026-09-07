/**
 * One-time Checkpoints sheet setup (run locally with `node scripts/setup-checkpoints-sheet.mjs`).
 *
 * Uses the app's EXISTING owner OAuth credentials (GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN from .env.local) —
 * no new auth setup. Verifies the spreadsheet at GOOGLE_SHEETS_CHECKPOINTS_ID
 * if one is configured, otherwise creates a fresh spreadsheet with the
 * EXACT "Checkpoints" tab + header row the app queries (Checkpoints!A1:H).
 *
 * Header authority: lib/checkpoints-sheet-schema.ts (CHECKPOINTS_HEADER).
 * Prints the final spreadsheet ID + link at the end. Safe to re-run:
 * an already-correct sheet is detected and left untouched (no duplicates).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

const WS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(WS, ".env.local") });

const schema = await import(
  pathToFileURL(path.join(WS, "lib", "checkpoints-sheet-schema.ts")).href
);
const CHECKPOINTS_TAB = schema.CHECKPOINTS_TAB;
const CHECKPOINTS_HEADER = [...schema.CHECKPOINTS_HEADER];
const SHEET_TITLE = "Vaayu Checkpoints";

const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? "";
const configuredId = (process.env.GOOGLE_SHEETS_CHECKPOINTS_ID ?? "").trim();

function isPlaceholder(id) {
  return !id || id.startsWith("build-phase-placeholder");
}

if (!clientId || !clientSecret || !refreshToken) {
  console.error(
    "Missing owner OAuth credentials in .env.local (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN)."
  );
  process.exit(1);
}

// 1. Mint a short-lived access token with the shared owner credentials.
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
const tokenData = await tokenRes.json().catch(() => null);
if (!tokenRes.ok || typeof tokenData?.access_token !== "string") {
  console.error(
    "Token exchange failed:",
    JSON.stringify({
      status: tokenRes.status,
      error: tokenData?.error ?? null,
      description: tokenData?.error_description ?? null,
    })
  );
  process.exit(1);
}
const accessToken = tokenData.access_token;
console.log("1. Access token minted.");

// 2. Confirm the token actually carries the Sheets scope (the refresh token
//    predating the Checkpoints feature is the classic silent-break cause).
const infoRes = await fetch(
  `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
);
const info = await infoRes.json().catch(() => null);
console.log("2. Granted scopes:", info?.scope ?? "(tokeninfo unavailable)");
const scopes = typeof info?.scope === "string" ? info.scope : "";
if (scopes && !scopes.includes("spreadsheets")) {
  console.error(
    "STOP: the refresh token lacks the Google Sheets permission. Re-run Admin → Drive setup → “Re-authorize with Google” first, then re-run this script."
  );
  process.exit(1);
}

const api = async (method, urlPath, body) => {
  const res = await fetch(`https://sheets.googleapis.com/v4${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

async function getSpreadsheet(id) {
  return api(
    "GET",
    `/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`
  );
}

async function ensureTabAndHeaders(id) {
  // Ensure the EXACT tab exists (idempotent: skip when already present).
  const meta = await getSpreadsheet(id);
  if (meta.status !== 200) {
    throw new Error(`spreadsheet lookup failed (HTTP ${meta.status})`);
  }
  const tabs = (meta.data?.sheets ?? [])
    .map((s) => s?.properties?.title)
    .filter((t) => typeof t === "string");
  if (!tabs.includes(CHECKPOINTS_TAB)) {
    console.log(`   Tab "${CHECKPOINTS_TAB}" missing — creating it...`);
    const add = await api(
      "POST",
      `/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: CHECKPOINTS_TAB } } }] }
    );
    if (add.status !== 200) {
      throw new Error(
        `addSheet failed (HTTP ${add.status}): ${JSON.stringify(add.data)?.slice(0, 300)}`
      );
    }
  } else {
    console.log(`   Tab "${CHECKPOINTS_TAB}" already exists — reusing.`);
  }
  // Ensure row 1 is EXACTLY the app's header (overwrite when wrong/missing;
  // data rows below are never touched).
  const got = await api(
    "GET",
    `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(`${CHECKPOINTS_TAB}!A1:H1`)}`
  );
  const firstRow = got.data?.values?.[0] ?? [];
  if (!schema.headerMatches(firstRow)) {
    console.log("   Writing header row A1:H1...");
    const put = await api(
      "PUT",
      `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(`${CHECKPOINTS_TAB}!A1:H1`)}?valueInputOption=RAW`,
      { values: [CHECKPOINTS_HEADER] }
    );
    if (put.status !== 200) {
      throw new Error(
        `header write failed (HTTP ${put.status}): ${JSON.stringify(put.data)?.slice(0, 300)}`
      );
    }
  } else {
    console.log("   Header row already correct — leaving data untouched.");
  }
  const finalMeta = await getSpreadsheet(id);
  return {
    id,
    url:
      finalMeta.data?.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${id}/edit`,
  };
}

// 3. Verify the configured ID, or create a fresh spreadsheet.
let final = null;
if (!isPlaceholder(configuredId)) {
  console.log(`3. Checking configured ID ${configuredId} ...`);
  const meta = await getSpreadsheet(configuredId);
  if (meta.status === 200) {
    console.log(`   Spreadsheet resolves: "${meta.data?.properties?.title}".`);
    final = await ensureTabAndHeaders(configuredId);
    console.log("   RESULT: existing sheet verified/repaired — no new sheet created.");
  } else if (meta.status === 404) {
    console.log("   404 — that ID is wrong/stale. Creating a fresh spreadsheet...");
  } else if (meta.status === 403) {
    console.error(
      `   Sheets API refused (HTTP 403): ${JSON.stringify(meta.data)?.slice(0, 300)}`
    );
    console.error(
      "   Likely causes: Sheets API not enabled in the Google Cloud project, or the token lacks access."
    );
    process.exit(1);
  } else {
    console.error(
      `   Unexpected lookup failure (HTTP ${meta.status}): ${JSON.stringify(meta.data)?.slice(0, 300)}`
    );
    process.exit(1);
  }
} else {
  console.log("3. GOOGLE_SHEETS_CHECKPOINTS_ID is unset/placeholder — creating a fresh spreadsheet...");
}

if (!final) {
  const created = await api("POST", "/spreadsheets", {
    properties: { title: SHEET_TITLE },
    sheets: [{ properties: { title: CHECKPOINTS_TAB } }],
  });
  if (created.status !== 200 || !created.data?.spreadsheetId) {
    console.error(
      `   Spreadsheet creation failed (HTTP ${created.status}): ${JSON.stringify(created.data)?.slice(0, 500)}`
    );
    if (created.status === 403) {
      console.error(
        "   If this says the Sheets API is not enabled, enable “Google Sheets API” in the same Google Cloud project, then re-run."
      );
    }
    process.exit(1);
  }
  console.log(`   Spreadsheet created.`);
  final = await ensureTabAndHeaders(created.data.spreadsheetId);
  console.log("   RESULT: brand-new sheet created.");
}

console.log("");
console.log("=== CHECKPOINTS SHEET READY ===");
console.log(`Env var name : GOOGLE_SHEETS_CHECKPOINTS_ID`);
console.log(`Spreadsheet ID: ${final.id}`);
console.log(`Sheet link   : ${final.url}`);
console.log("Next: paste the ID into .env.local locally AND into Vercel env vars, then redeploy.");
