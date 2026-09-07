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
// Hidden files keep their real names; dot-only names collapse, never navigate
assert.strictEqual(drive.sanitizeFileName(".gitignore", ""), ".gitignore");
assert.strictEqual(drive.sanitizeFileName(".DS_Store", ""), ".DS_Store");
assert.strictEqual(drive.sanitizeFolderName(".git"), ".git");
assert.strictEqual(drive.sanitizeFileName("..", ".txt"), "upload.txt");

// 3. Real Drive ceilings exported (no app-level caps below these exist)
assert.strictEqual(drive.DRIVE_MAX_SINGLE_FILE_BYTES, 5 * 1024 ** 4); // 5 TB
assert.strictEqual(drive.DRIVE_DAILY_UPLOAD_CAP_BYTES, 750 * 1024 ** 3); // 750 GB

// 4. validateUpload(name, size) — every type, every Drive-legal size
const ok1 = drive.validateUpload("project.zip", 1024 * 1024);
assert.strictEqual("name" in ok1, true);
// Formerly rejected extensions still pass (no type gating)
assert.strictEqual("name" in drive.validateUpload("tool.exe", 1024), true);
assert.strictEqual("name" in drive.validateUpload("notes.xyzabc", 100), true);
assert.strictEqual("name" in drive.validateUpload("README", 512), true);
// 0-byte files are real uploads (.gitkeep, placeholders) — allowed now
assert.strictEqual("name" in drive.validateUpload("empty.txt", 0), true);
// Large files pass all the way to Drive's own 5 TB ceiling
assert.strictEqual(
  "name" in drive.validateUpload("big.bin", 600 * 1024 * 1024),
  true
);
assert.strictEqual(
  "name" in drive.validateUpload("huge.bin", 5 * 1024 ** 4),
  true
);
// Past 5 TB rejected with a clear limit message
const tooBig = drive.validateUpload("huge.bin", 5 * 1024 ** 4 + 1);
assert.strictEqual("error" in tooBig, true);
assert.match(tooBig.error, /5 TB/);
// Negative / NaN sizes rejected
assert.strictEqual("error" in drive.validateUpload("x.bin", -1), true);
assert.strictEqual("error" in drive.validateUpload("x.bin", NaN), true);

// 5. splitRelativePath — pure path splitting, backslash normalization
assert.deepStrictEqual(drive.splitRelativePath("a/b/c.ts"), ["a", "b", "c.ts"]);
assert.deepStrictEqual(drive.splitRelativePath("a\\b\\c.ts"), ["a", "b", "c.ts"]);
assert.deepStrictEqual(drive.splitRelativePath("/a//b/"), ["a", "b"]);
assert.deepStrictEqual(drive.splitRelativePath(""), []);
assert.deepStrictEqual(drive.splitRelativePath(null), []);
assert.deepStrictEqual(drive.splitRelativePath(undefined), []);

// 6. sanitizeFolderName — navigation segments can never survive
assert.strictEqual(drive.sanitizeFolderName(".."), "unnamed");
assert.strictEqual(drive.sanitizeFolderName("."), "unnamed");
assert.strictEqual(drive.sanitizeFolderName("src"), "src");
assert.strictEqual(drive.sanitizeFolderName("my:folder"), "myfolder");

// 7. resolveUploadDestination — leaf + locked-root-relative chain
const dest = drive.resolveUploadDestination("myproj/src/a.ts", "fallback", 10);
assert.strictEqual(dest.fileName, "a.ts");
assert.deepStrictEqual(dest.dirParts, ["myproj", "src"]);
// No relativePath → file lands directly in the locked root
const rootDest = drive.resolveUploadDestination(undefined, "lone.bin", 10);
assert.strictEqual(rootDest.fileName, "lone.bin");
assert.deepStrictEqual(rootDest.dirParts, []);
// Traversal attempts become harmless folder NAMES (never navigation)
const evil = drive.resolveUploadDestination("../../etc/passwd", "f", 10);
assert.strictEqual(evil.fileName, "passwd");
assert.ok(!evil.dirParts.includes("..") && !evil.dirParts.includes("."));
assert.deepStrictEqual(
  drive.resolveUploadDestination("a/./b/../c.txt", "f", 10).dirParts,
  ["a", "unnamed", "b", "unnamed"]
);
// Oversized single file rejected before any folder work
assert.throws(
  () => drive.resolveUploadDestination("a/b.bin", "f", 5 * 1024 ** 4 + 1),
  drive.DriveValidationError
);
// Absurd depth rejected with the nesting-limit message
const deep = Array.from({ length: 95 }, (_, i) => `d${i}`).join("/") + "/f.txt";
assert.throws(
  () => drive.resolveUploadDestination(deep, "f", 10),
  /100 levels/
);

// 8. describeDriveApiError — Drive's real failures become clear messages
const quotaBody = JSON.stringify({
  error: {
    code: 403,
    message: "The user has exceeded their Drive upload quota.",
    errors: [{ reason: "rateLimitExceeded", message: "Rate limit exceeded." }],
  },
});
assert.match(drive.describeDriveApiError(403, quotaBody), /750 GB/);
const dailyBody = JSON.stringify({
  error: {
    code: 403,
    message: "Daily Limit Exceeded",
    errors: [{ reason: "dailyLimitExceeded" }],
  },
});
assert.match(drive.describeDriveApiError(403, dailyBody), /750 GB/);
assert.match(drive.describeDriveApiError(413, "{}"), /5 TB/);
const storageBody = JSON.stringify({
  error: {
    code: 403,
    message: "The user's Drive storage quota has been exceeded.",
    errors: [{ reason: "storageQuotaExceeded" }],
  },
});
assert.match(drive.describeDriveApiError(403, storageBody), /storage is full/i);
const otherBody = JSON.stringify({
  error: { code: 400, message: "Invalid file name." },
});
assert.match(drive.describeDriveApiError(400, otherBody), /Invalid file name/);
assert.match(drive.describeDriveApiError(500, "not-json{{{").toLowerCase(), /http 500/);

// 9. uploadHttpError — route status mapping
assert.deepStrictEqual(
  drive.uploadHttpError(new drive.DriveValidationError("[drive] nope")),
  { status: 400, message: "nope" }
);
assert.strictEqual(
  drive.uploadHttpError(new drive.DriveValidationError("[drive] x 5 TB single-file y")).status,
  413
);
const quotaErr = new Error(`[drive] upload failed (HTTP 403): ${quotaBody}`);
assert.strictEqual(drive.uploadHttpError(quotaErr).status, 429);
assert.match(drive.uploadHttpError(quotaErr).message, /750 GB/);
const genericErr = new Error("[drive] upload failed (HTTP 500): {}");
assert.strictEqual(drive.uploadHttpError(genericErr).status, 502);

// 10. uploadDriveFile refuses a bad folder ID before any network call
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

// 11. Resumable sessions refuse bad input before any network call
await assert.rejects(
  () =>
    drive.createResumableUploadSession("bogus-token", {
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: -1,
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
// ...including hostile relative paths (resolved without network)
await assert.rejects(
  () =>
    drive.createResumableUploadSession("bogus-token", {
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: 10,
      folderId: "../escape",
      relativePath: "a/b.bin",
    }),
  drive.DriveValidationError
);

// 12. ensureSubfolderPath refuses a bad root before any network call
await assert.rejects(
  () => drive.ensureSubfolderPath("bogus-token", "../escape", ["a"]),
  drive.DriveValidationError
);

console.log("All validation tests passed!");
