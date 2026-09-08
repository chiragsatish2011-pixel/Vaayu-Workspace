import assert from "node:assert";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath, pathToFileURL } from "node:url";

const WS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(WS, ".env.local") });

// Import the REAL shipping code (same functions the routes call).
const drive = await import(
  pathToFileURL(path.join(WS, "lib", "drive.ts")).href
);

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
const folderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
assert.ok(clientId && clientSecret && refreshToken && folderId, "Drive creds missing from .env.local");

// 1. Token (same exchange every /api/drive route uses)
const token = await drive.getDriveAccessToken(clientId, clientSecret, refreshToken);
console.log("1. access token: OK");

// 2. Root metadata (mirrors GET /api/drive/root)
const metaRes = await fetch(
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,trashed`,
  { headers: { Authorization: `Bearer ${token}` } }
);
assert.strictEqual(metaRes.status, 200, "root folder must resolve");
const meta = await metaRes.json();
console.log(`2. root folder: "${meta.name}" (${meta.id})`);

// 3. LIST first level (mirrors browse route's listDriveFolderContents)
const before = await drive.listDriveFolderContents(token, folderId);
console.log(`3. list: ${before.length} top-level items`);

// 3b. Pre-cleanup: remove any probe leftovers from earlier interrupted runs
for (const f of before) {
  if (f.name.startsWith("files-page-verify-") && !f.isFolder) {
    await drive.trashDriveFile(token, f.id);
    await drive.deleteDriveFile(token, f.id);
    console.log(`3b. cleaned leftover probe: ${f.name}`);
  }
}

// 4. UPLOAD tiny probe via the real multipart path (folder lock enforced inside)
const probeName = `files-page-verify-${Date.now()}.txt`;
const uploaded = await drive.uploadDriveFile(token, {
  name: probeName,
  mimeType: "text/plain",
  bytes: new Blob(["files-page verification probe — safe to delete"]),
  folderId,
});
console.log(`4. uploaded probe: ${uploaded.id} parents locked to folder`);

// 5. Descendant check passes for legit items (trash route's security gate)
assert.strictEqual(
  await drive.isDescendantOfFolder(token, uploaded.id, folderId),
  true,
  "fresh upload must verify as inside the locked folder"
);
assert.strictEqual(
  await drive.isDescendantOfFolder(token, "1abcDEFghijklMNOp", folderId),
  false,
  "bogus id must fail closed"
);
console.log("5. descendant check: legit=true, bogus=false");

// 6. Probe visible in listing (fresh read — same as the UI's post-upload refetch)
const during = await drive.listDriveFolderContents(token, folderId, { fresh: true });
assert.ok(
  during.some((f) => f.id === uploaded.id),
  "probe must appear in listing"
);
console.log("6. probe visible in listing: OK");

// 7. TRASH via the real trash path (soft-delete, recoverable)
await drive.trashDriveFile(token, uploaded.id);
const trashedMeta = await (
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}?fields=id,trashed`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
).json();
assert.strictEqual(trashedMeta.trashed, true, "probe must be trashed, not deleted");
console.log("7. trash: OK (trashed=true, recoverable from Drive Trash)");

// 8. Listing reflects trash immediately (cache invalidation path)
const after = await drive.listDriveFolderContents(token, folderId, { fresh: true });
assert.ok(
  !after.some((f) => f.id === uploaded.id),
  "trashed probe must disappear from listing at once"
);
console.log("8. listing fresh after trash (no stale cache): OK");

// 9. Permanent cleanup of the probe itself (zero trace left behind)
await drive.deleteDriveFile(token, uploaded.id);
console.log("9. probe permanently deleted: folder left exactly as found");

console.log("\nFiles-page server paths verified live: root, list, upload, descendant-gate, trash, freshness, cleanup.");
