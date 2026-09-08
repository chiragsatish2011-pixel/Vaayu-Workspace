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

const token = await drive.getDriveAccessToken(clientId, clientSecret, refreshToken);
console.log("0. access token: OK");

async function meta(id, fields = "id,name,parents,trashed") {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.strictEqual(res.status, 200, `metadata get ${id} must resolve`);
  return res.json();
}

const ts = Date.now();

// Pre-cleanup leftovers from interrupted runs (any trash state — search
// across trashed and untrashed, since a trashed parent hides children
// from normal listings).
{
  const q = encodeURIComponent(`name contains '__verify_mgr_'`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,trashed)&pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json().catch(() => null);
  for (const f of data?.files ?? []) {
    if (!f?.id) continue;
    try {
      if (!f.trashed) await drive.trashDriveFile(token, f.id);
      await drive.deleteDriveFile(token, f.id);
      console.log(`pre-cleaned leftover: ${f.name}`);
    } catch { /* already gone — fine */ }
  }
}

// 1. CREATE two folders at root (mirrors POST /api/drive/create-folder).
const A = await drive.createDriveFolder(token, folderId, `__verify_mgr_A_${ts}`);
const B = await drive.createDriveFolder(token, folderId, `__verify_mgr_B_${ts}`);
assert.ok(A.id && B.id, "both folders must be created");
const aMeta = await meta(A.id);
assert.ok(aMeta.parents.includes(folderId), "A must land directly under root");
console.log(`1. create: A=${A.id} B=${B.id} under root: OK`);

// 2. MOVE folder B into folder A (mirrors POST /api/drive/move).
const movedB = await drive.moveDriveFile(token, B.id, A.id);
assert.ok(movedB.parents.includes(A.id), "B.parents must become [A]");
console.log("2. move folder B into A: OK");

// 3. UPLOAD file at root, then MOVE it into B (nested two levels deep).
const uploaded = await drive.uploadDriveFile(token, {
  name: `__verify_mgr_note_${ts}.txt`,
  mimeType: "text/plain",
  bytes: new Blob(["manager verification probe — safe to delete"]),
  folderId,
});
const movedF = await drive.moveDriveFile(token, uploaded.id, B.id);
assert.ok(movedF.parents.includes(B.id), "file.parents must become [B]");
console.log("3. upload at root + move into B: OK");

// 4. RENAME folder B (mirrors POST /api/drive/rename).
const renamed = await drive.renameDriveFile(token, B.id, `__verify_mgr_B_renamed_${ts}`);
assert.ok(renamed.name.startsWith("__verify_mgr_B_renamed_"), `unexpected name: ${renamed.name}`);
console.log(`4. rename: now "${renamed.name}": OK`);

// 5. Route-guard predicates (the checks the API routes enforce server-side).
assert.strictEqual(await drive.isDescendantOfFolder(token, A.id, folderId), true, "A inside root");
assert.strictEqual(await drive.isDescendantOfFolder(token, B.id, A.id), true, "B inside A");
assert.strictEqual(await drive.isDescendantOfFolder(token, folderId, A.id), false, "root NOT inside A (cycle guard predicate)");
assert.strictEqual(await drive.isDescendantOfFolder(token, "1abcDEFghijklMNOp", folderId), false, "bogus id fails closed");
console.log("5. guard predicates: cycle/root/bogus all refuse correctly: OK");

// 6. DELETE folder A via trash — Drive semantics take the whole subtree.
// Trashed flags propagate to descendants eventually (not instantly), so
// poll briefly rather than asserting immediately.
await drive.trashDriveFile(token, A.id);
async function waitTrashed(id, label) {
  const deadline = Date.now() + 45000;
  for (;;) {
    const m = await meta(id);
    if (m.trashed) return;
    if (Date.now() > deadline) {
      assert.fail(`${label} never showed trashed=true`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
await waitTrashed(A.id, "A");
await waitTrashed(B.id, "renamed B");
await waitTrashed(uploaded.id, "nested file");
const treeAfter = await drive.listDriveTree(token, folderId, { fresh: true });
assert.ok(
  !treeAfter.some(({ file }) => file.name.startsWith("__verify_mgr_")),
  "no probe names remain visible in the tree"
);
console.log("6. trash folder: recursive (folder + renamed child + nested file), listing clean: OK");

// 7. Permanent cleanup (zero trace left behind).
await drive.deleteDriveFile(token, uploaded.id);
await drive.deleteDriveFile(token, B.id);
await drive.deleteDriveFile(token, A.id);
console.log("7. probe permanently deleted: folder left exactly as found");

console.log("\nFiles-manager server paths verified live: create, move, rename, guards, recursive trash, cleanup.");
