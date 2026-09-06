import assert from "node:assert";

// 1. Test Drive File ID validation
function isValidDriveFileId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(id);
}
assert.strictEqual(isValidDriveFileId("1abc_XYZ-123"), true);
assert.strictEqual(isValidDriveFileId("../secret"), false);
assert.strictEqual(isValidDriveFileId(""), false);
assert.strictEqual(isValidDriveFileId(null), false);

// 2. Test sanitizeFileName
function sanitizeFileName(raw, fallbackExt) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let clean = base
    .replace(/[\0-\x1f\x7f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!clean) clean = `upload${fallbackExt}`;
  if (clean.length > 120) {
    clean = clean.slice(0, 120 - fallbackExt.length) + fallbackExt;
  }
  return clean;
}
assert.strictEqual(sanitizeFileName("../../../malicious/test.zip", ".zip"), "test.zip");
assert.strictEqual(sanitizeFileName("my archive : * < > ? .tar.gz", ".tar.gz"), "my archive .tar.gz");

// 3. Test validateUpload constraints
const CODEBASE_MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const CODEBASE_EXTENSIONS = [".zip", ".tar.gz"];
const PREVIEW_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const CODEBASE_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/octet-stream",
]);
const PREVIEW_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/octet-stream",
]);

function extensionOf(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function validateUpload(kind, originalName, mimeType, size) {
  const ext = extensionOf(originalName);
  if (kind === "codebase") {
    if (!CODEBASE_EXTENSIONS.includes(ext)) {
      return { error: `Codebase file must be one of: ${CODEBASE_EXTENSIONS.join(", ")}.` };
    }
    if (!CODEBASE_MIMES.has(mimeType.toLowerCase())) {
      return { error: `Unexpected file type (${mimeType || "unknown"}).` };
    }
    if (size > CODEBASE_MAX_BYTES) {
      return { error: `Codebase file is too large (max ${CODEBASE_MAX_BYTES / 1024 / 1024} MB).` };
    }
    return { name: sanitizeFileName(originalName, ext) };
  }
  if (!PREVIEW_EXTENSIONS.includes(ext)) {
    return { error: `Preview image must be one of: ${PREVIEW_EXTENSIONS.join(", ")}.` };
  }
  if (!PREVIEW_MIMES.has(mimeType.toLowerCase())) {
    return { error: `Unexpected image type (${mimeType || "unknown"}).` };
  }
  if (size > PREVIEW_MAX_BYTES) {
    return { error: `Preview image is too large (max ${PREVIEW_MAX_BYTES / 1024 / 1024} MB).` };
  }
  return { name: sanitizeFileName(originalName, ext) };
}

// Valid zip codebase
const r1 = validateUpload("codebase", "project.zip", "application/zip", 1024 * 1024);
assert.strictEqual("name" in r1, true);

// Invalid extension for codebase (.exe)
const r2 = validateUpload("codebase", "virus.exe", "application/octet-stream", 1024);
assert.strictEqual("error" in r2, true);

// Codebase over 50MB
const r3 = validateUpload("codebase", "huge.zip", "application/zip", 60 * 1024 * 1024);
assert.strictEqual("error" in r3, true);

// Valid preview image
const r4 = validateUpload("preview", "screenshot.png", "image/png", 500 * 1024);
assert.strictEqual("name" in r4, true);

// Invalid image extension (.pdf)
const r5 = validateUpload("preview", "doc.pdf", "application/pdf", 1024);
assert.strictEqual("error" in r5, true);

console.log("All validation tests passed!");
