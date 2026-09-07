import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const drive = await import(
  pathToFileURL(path.join(WS, "lib", "drive.ts")).href
);

// 1. Drive file/folder ID validation (folder lock depends on this)
assert.strictEqual(drive.isValidDriveFileId("1abc_XYZ-123"), true);
assert.strictEqual(drive.isValidDriveFileId("../secret"), false);
assert.strictEqual(drive.isValidDriveFileId(""), false);
assert.strictEqual(drive.isValidDriveFileId(null), false);

// 2. sanitizeFileName — no path can escape the locked folder
assert.strictEqual(
  drive.sanitizeFileName("../../../malicious/test.zip", ".zip"),
  "test.zip"
);
assert.strictEqual(
  drive.sanitizeFileName("my archive : * < > ? .tar.gz", ".tar.gz"),
  "my archive .tar.gz"
);

// 3. validateUpload(name, size) — any file type Drive supports
const ok1 = drive.validateUpload("project.zip", 1024 * 1024);
assert.strictEqual("name" in ok1, true);
// Formerly rejected extensions now pass (no type gating)
assert.strictEqual("name" in drive.validateUpload("tool.exe", 1024), true);
assert.strictEqual("name" in drive.validateUpload("notes.xyzabc", 100), true);
assert.strictEqual("name" in drive.validateUpload("README", 512), true);
// 0-byte / corrupt rejected
assert.strictEqual("error" in drive.validateUpload("empty.txt", 0), true);
// Over the app limit rejected
assert.strictEqual(
  "error" in drive.validateUpload("big.bin", 600 * 1024 * 1024),
  true
);

// 4. uploadDriveFile refuses a bad folder ID before any network call
await assert.rejects(
  () =>
    drive.uploadDriveFile("bogus-token", {
      name: "x.bin",
      mimeType: "application/octet-stream",
      bytes: new Blob(["x"]),
      folderId: "../escape",
    }),
  /Invalid destination folder ID/
);

// 5. Resumable sessions refuse bad input before any network call
await assert.rejects(
  () =>
    drive.createResumableUploadSession("bogus-token", {
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: 0,
      folderId: "fine",
    }),
  drive.DriveValidationError
);
await assert.rejects(
  () =>
    drive.createResumableUploadSession("bogus-token", {
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: 10,
      folderId: "../escape",
    }),
  drive.DriveValidationError
);

console.log("All validation tests passed!");
