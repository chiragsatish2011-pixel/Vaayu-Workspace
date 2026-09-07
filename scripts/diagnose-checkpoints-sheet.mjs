/**
 * Diagnose the exact spreadsheet ID independently of the app's read/append
 * paths (no store code, no env-var reads for the ID — it is passed inline).
 *
 * Usage: node scripts/diagnose-checkpoints-sheet.mjs [spreadsheetId]
 *
 * Prints raw HTTP statuses + bodies for:
 *   1. Sheets API spreadsheets.get (whole file: title, tabs)
 *   2. Sheets API values.get on "Checkpoints!A1:H1" (the tab the app needs)
 *   3. Drive API files.get (same ID — distinguishes "no such file" from
 *      "Sheets-scope visibility" since Drive uses the same owner token)
 *   4. The OAuth scopes on the local token (a drive.file-only token cannot
 *      see sheets it did not create — a 404 then is expected, not proof
 *      the ID is bad; this script says so explicitly).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const WS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(WS, ".env.local") });

const targetId = (process.argv[2] ?? "").trim();
if (!targetId) {
  console.error("Usage: node scripts/diagnose-checkpoints-sheet.mjs <spreadsheetId>");
  process.exit(1);
}
console.log(`Target ID   : ${JSON.stringify(targetId)}`);
console.log(`ID length   : ${targetId.length}`);

const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? "";

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
  console.error("Token exchange failed:", tokenRes.status, JSON.stringify(tokenData));
  process.exit(1);
}
const token = tokenData.access_token;

const infoRes = await fetch(
  `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
);
const info = await infoRes.json().catch(() => null);
const scopes = typeof info?.scope === "string" ? info.scope : "";
console.log(`Token scopes: ${scopes || "(unavailable)"}`);
const sheetsScoped = scopes.includes("/auth/spreadsheets");
console.log(`Sheets scope : ${sheetsScoped ? "YES" : "NO (drive.file only)"}`);

async function show(label, url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let summary = text;
  try {
    const data = JSON.parse(text);
    summary = JSON.stringify(data).slice(0, 600);
  } catch {
    summary = text.slice(0, 600);
  }
  console.log(`--- ${label}: HTTP ${res.status}`);
  console.log(summary || "(empty body)");
  return res.status;
}

const enc = encodeURIComponent(targetId);
const s1 = await show(
  "Sheets spreadsheets.get (whole file)",
  `https://sheets.googleapis.com/v4/spreadsheets/${enc}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties.title`
);
const s2 = await show(
  "Sheets values.get Checkpoints!A1:H1 (the tab the app needs)",
  `https://sheets.googleapis.com/v4/spreadsheets/${enc}/values/${encodeURIComponent("Checkpoints!A1:H1")}`
);
const s3 = await show(
  "Drive files.get (same ID, same token)",
  `https://www.googleapis.com/drive/v3/files/${enc}?fields=id,name,mimeType,trashed`
);

console.log("=== INTERPRETATION ===");
if (s1 === 200) {
  console.log("The spreadsheet ID resolves. If the app still 404s in production, the live env value/deployment/scope differs — see the admin health endpoint output, not this script.");
} else if (s1 === 404 && !sheetsScoped) {
  console.log("404 WITH a drive.file-only token is AMBIGUOUS: it means 'bad ID' OR 'sheet exists but this token cannot see it' (manually created sheets are invisible to drive.file). This does NOT prove the ID is wrong.");
} else if (s1 === 404) {
  console.log("404 with Sheets scope: the ID is wrong/stale, or the sheet was never shared with this Google account.");
} else if (s1 === 403) {
  console.log("403: auth/scope/API-enablement problem, not an ID problem. Read the body above.");
} else {
  console.log(`Unexpected status ${s1} — read the bodies above.`);
}
if (s1 === 200 && s2 === 404) {
  console.log("NOTE: file resolves but the Checkpoints tab read 404s — that is a TAB problem (missing/renamed tab), not an ID problem.");
}
void s3;
