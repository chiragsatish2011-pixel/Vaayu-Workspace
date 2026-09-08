/**
 * Google Drive backend client (SERVER ONLY — never import from client code).
 *
 * The browser NEVER sees Google credentials. Every function below runs in a
 * Node.js API route: the route holds the owner's OAuth refresh token (from
 * `GOOGLE_DRIVE_REFRESH_TOKEN`, a server-side env var), exchanges it for a
 * short-lived access token, and calls the Drive v3 REST API with plain
 * `fetch` — no googleapis dependency needed.
 *
 * Token lifecycle: access tokens expire (~1h); the refresh token does not
 * (until revoked). Each API call mints a fresh access token — simple and
 * stateless, fitting Vercel serverless (no token store, no background
 * refresh worker).
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Read/write access to the spreadsheets the app uses (Checkpoints store). */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
/**
 * Scopes requested at the one-time owner consent (Admin → Drive setup).
 * Drive backend + Sheets store share one OAuth client and one refresh token.
 */
export const GOOGLE_SCOPES = `${DRIVE_SCOPE} ${SHEETS_SCOPE}`;
export const DRIVE_FOLDER_NAME = "Vaayu-Workspace-Projects";

/** Upload constraints: Google Drive's own real technical ceilings.
 *
 * The app enforces NOTHING smaller than these. Do not add a lower cap
 * "just to be safe" — uploads go all the way to Drive's actual limits and
 * Drive itself rejects anything beyond them (surfaced via
 * describeDriveApiError / uploadHttpError, never a silent hang).
 */
export const DRIVE_MAX_SINGLE_FILE_BYTES = 5 * 1024 ** 4; // 5 TB per file
export const DRIVE_DAILY_UPLOAD_CAP_BYTES = 750 * 1024 ** 3; // 750 GB/day/account
/** Drive folders can nest up to 100 levels deep — relative trees deeper than
 * this headroom are refused with a clear error instead of failing in Drive. */
export const DRIVE_MAX_RELATIVE_DEPTH = 90;
/**
 * Google's multipart upload caps at 5 MB per file — anything larger must use
 * a resumable session (createResumableUploadSession). The proxy route
 * (/api/drive/upload) only serves multipart, so it rejects larger files.
 */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Thrown for bad upload input (as opposed to Google API failures). */
export class DriveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveValidationError";
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

/** Drive file/folder IDs are alphanumeric, hyphen and underscore strings. */
export function isValidDriveFileId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(id);
}

/**
 * Strip directories, control chars and Drive-hostile characters; keep the
 * extension; cap length. Never trust the client filename.
 *
 * Leading dots are PRESERVED (.git, .env, .DS_Store upload under their real
 * names) — only dot-only names (".", "..") collapse to the fallback, so
 * they can never act as navigation.
 */
export function sanitizeFileName(raw: string, fallbackExt: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let clean = base
    .replace(/[\0-\x1f\x7f<>:"|?*]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (/^\.+$/.test(clean)) clean = "";
  if (!clean) clean = `upload${fallbackExt}`;
  if (clean.length > 120) {
    clean = clean.slice(0, 120 - fallbackExt.length) + fallbackExt;
  }
  return clean;
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

/**
 * Validate an uploaded file for Drive storage:
 * - Accepts EVERY file type Google Drive naturally stores (no extension or
 *   MIME gating — Drive holds arbitrary binary files regardless of suffix).
 * - Accepts every size up to Drive's own 5 TB single-file ceiling. No
 *   app-level cap below that exists anywhere in this file.
 * - Accepts 0-byte files (common in real trees: .gitkeep, empty __init__
 *   markers, placeholders) — if the user selected it, it goes up.
 * - Sanitizes the filename so no path can escape the locked folder.
 */
export function validateUpload(
  originalName: string,
  size: number
): { name: string } | { error: string } {
  if (typeof size !== "number" || Number.isNaN(size) || size < 0) {
    return { error: "Invalid file size." };
  }
  if (size > DRIVE_MAX_SINGLE_FILE_BYTES) {
    return {
      error:
        "File exceeds Google Drive's 5 TB single-file limit and cannot be uploaded.",
    };
  }
  const ext = extensionOf(originalName);
  return { name: sanitizeFileName(originalName, ext) };
}

/* ── Locked-folder subfolder trees (Requirement 1) ───────────────────
 *
 * Folder uploads arrive with a client-reported relative path such as
 * "myproj/src/components/App.tsx". That path is NEVER trusted for
 * navigation: every segment is sanitized into a plain folder NAME (".",
 * "..", slashes and Drive-hostile characters cannot survive
 * sanitization), and the folder chain is built strictly DOWNWARD from the
 * pre-assigned root folder — every create/find pins parents=[currentId].
 * By construction no file or folder can land in Drive root or anywhere
 * outside the locked root, no matter what the client sends.
 */

/** Split a client-reported relative path into raw segments. Pure. */
export function splitRelativePath(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Sanitize one folder-name segment. Reuses the file-name sanitizer, so
 * ".." → "" → "unnamed", "." → "unnamed", "a/b" is impossible (split
 * already), and control/Drive-hostile chars are stripped. Never returns "".
 */
export function sanitizeFolderName(raw: string): string {
  const cleaned = sanitizeFileName(raw, "");
  return cleaned === "" || cleaned === "upload" ? "unnamed" : cleaned;
}

export interface ResolvedUploadDestination {
  /** Sanitized leaf file name. */
  fileName: string;
  /** Sanitized subfolder names, strictly inside the locked root. */
  dirParts: string[];
}

/**
 * Resolve (pure, no network) where an upload lands: the leaf name plus the
 * subfolder chain under the locked root. Throws DriveValidationError when
 * the tree would nest deeper than Drive allows.
 */
export function resolveUploadDestination(
  rawRelativePath: unknown,
  fallbackName: string,
  size: number
): ResolvedUploadDestination {
  const segments = splitRelativePath(rawRelativePath);
  const rawLeaf =
    segments.length > 0
      ? (segments[segments.length - 1] as string)
      : fallbackName;
  const checked = validateUpload(rawLeaf, size);
  if ("error" in checked) {
    throw new DriveValidationError(`[drive] ${checked.error}`);
  }
  const dirParts = segments
    .slice(0, -1)
    .map((s) => sanitizeFolderName(s));
  if (dirParts.length > DRIVE_MAX_RELATIVE_DEPTH) {
    throw new DriveValidationError(
      `[drive] Folder is nested too deep (over ${DRIVE_MAX_RELATIVE_DEPTH} levels) — Google Drive allows at most 100 levels of folders.`
    );
  }
  return { fileName: checked.name, dirParts };
}

/** Escape a value for embedding in a Drive search query string literal. */
function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function findChildFolder(
  accessToken: string,
  parentId: string,
  name: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = ${driveQueryLiteral(name)} and ${driveQueryLiteral(parentId)} in parents and trashed = false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const data = (await res.json().catch(() => null)) as {
    files?: { id?: unknown }[];
  } | null;
  if (!res.ok) {
    throw driveError("find subfolder", res.status, JSON.stringify(data));
  }
  const id = data?.files?.[0]?.id;
  return typeof id === "string" ? id : null;
}

async function createChildFolder(
  accessToken: string,
  parentId: string,
  name: string
): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  if (!res.ok || typeof data?.id !== "string") {
    throw driveError("create subfolder", res.status, JSON.stringify(data));
  }
  return data.id;
}

/**
 * Walk/create the sanitized subfolder chain strictly UNDER rootFolderId.
 * Returns the deepest folder (the file's direct parent) plus the
 * top-level folder of this tree (null when the file sits directly in the
 * locked root). Every lookup and create pins parents to the chain, so the
 * tree cannot escape the locked root.
 *
 * Batch memoization: every prefix of the chain (root+a, root+a+b, …) is
 * memoized with a 5-minute TTL, and concurrent resolutions of the same
 * prefix share one in-flight promise. Without this, a 3k-file batch
 * re-runs the same Drive folder lookups thousands of times (one lookup
 * per segment per file); with it, each unique folder resolves exactly
 * once per batch. The in-flight sharing also closes a duplicate-folder
 * race: two files racing to create the same folder would otherwise both
 * miss the lookup and create twins.
 */
const folderMemo = new Map<string, { id: string; at: number }>();
const inflightFolders = new Map<string, Promise<string>>();
const FOLDER_MEMO_TTL_MS = 5 * 60 * 1000;
const MAX_FOLDER_MEMO = 5000;

function folderMemoKey(rootFolderId: string, prefix: string[]): string {
  return `${rootFolderId}\n${prefix.join("\n")}`;
}

function folderMemoGet(key: string): string | null {
  const hit = folderMemo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > FOLDER_MEMO_TTL_MS) {
    folderMemo.delete(key);
    return null;
  }
  return hit.id;
}

function folderMemoSet(key: string, id: string): void {
  if (folderMemo.size >= MAX_FOLDER_MEMO) folderMemo.clear();
  folderMemo.set(key, { id, at: Date.now() });
}

export async function ensureSubfolderPath(
  accessToken: string,
  rootFolderId: string,
  dirParts: string[]
): Promise<{ parentFolderId: string; topFolderId: string | null }> {
  if (!isValidDriveFileId(rootFolderId)) {
    throw new DriveValidationError(
      `[drive] Invalid destination folder ID (${rootFolderId}).`
    );
  }
  let current = rootFolderId;
  let top: string | null = null;
  const prefix: string[] = [];
  for (const part of dirParts) {
    prefix.push(part);
    const key = folderMemoKey(rootFolderId, prefix);
    let step = folderMemoGet(key);
    if (step === null) {
      const inflight = inflightFolders.get(key);
      if (inflight) {
        step = await inflight;
      } else {
        // NOTE: `current` is captured per iteration — the worker awaits
        // each step before advancing, so the closure always sees this
        // level's true parent (same prefix ⇒ same parent for every file).
        const parentId = current;
        const creating = (async () => {
          const existing = await findChildFolder(accessToken, parentId, part);
          const id =
            existing ?? (await createChildFolder(accessToken, parentId, part));
          if (!isValidDriveFileId(id)) {
            throw driveError("resolve subfolder", 502, JSON.stringify({ id }));
          }
          folderMemoSet(key, id);
          return id;
        })();
        inflightFolders.set(key, creating);
        try {
          step = await creating;
        } finally {
          inflightFolders.delete(key);
        }
      }
    }
    if (prefix.length === 1) top = step;
    current = step;
  }
  return { parentFolderId: current, topFolderId: top };
}

/* ── Drive-limit error mapping (real ceilings, clear messages) ───────
 *
 * Google Drive enforces a 5 TB single-file ceiling and a ~750 GB/day
 * account-wide upload cap. When Drive rejects an upload for those (or any
 * other) reasons, the raw API response must reach the user as a clear,
 * specific message — never a silent hang or a generic crash.
 */

function extractGoogleMessage(body: string): string | null {
  try {
    const data = JSON.parse(body) as {
      error?: { message?: unknown; errors?: { reason?: unknown }[] };
    };
    const msg = data?.error?.message;
    return typeof msg === "string" && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

function extractGoogleReason(body: string): string {
  try {
    const data = JSON.parse(body) as {
      error?: { errors?: { reason?: unknown }[] };
    };
    const reason = data?.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : "";
  } catch {
    return "";
  }
}

/** True when a Google 403/429 means the account hit its upload quota. */
function isDailyUploadCapSignal(status: number, body: string): boolean {
  if (status !== 403 && status !== 429) return false;
  const reason = extractGoogleReason(body);
  // Storage-full is separate (free up space vs. wait 24h) — never label it
  // as the daily cap.
  if (reason === "storageQuotaExceeded") return false;
  const message = extractGoogleMessage(body) ?? "";
  if (/storage quota/i.test(message)) return false;
  if (
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    reason === "dailyLimitExceeded" ||
    reason === "quotaExceeded" ||
    reason === "downloadQuotaExceeded"
  ) {
    return true;
  }
  const hay = `${reason} ${message}`.toLowerCase();
  return (
    hay.includes("daily limit") ||
    hay.includes("daily upload") ||
    hay.includes("upload limit") ||
    hay.includes("rate limit") ||
    hay.includes("user rate") ||
    (hay.includes("quota") && hay.includes("exceeded"))
  );
}

export const DRIVE_DAILY_CAP_MESSAGE =
  "Google Drive's daily upload limit (750 GB per account per day) has been reached. No more uploads will succeed until it resets in about 24 hours. Please try again tomorrow.";
export const DRIVE_SINGLE_FILE_LIMIT_MESSAGE =
  "This file exceeds Google Drive's 5 TB single-file limit and cannot be uploaded.";
export const DRIVE_STORAGE_FULL_MESSAGE =
  "Google Drive storage is full, so this upload was rejected. Free up space in Drive and try again.";

/**
 * Turn a raw Google API failure into a user-facing message. Pure (no
 * network) — safe to unit-test with recorded Drive responses.
 */
export function describeDriveApiError(status: number, body: string): string {
  const safeBody = body.slice(0, 500);
  // Storage-full is its own condition (free up space) — check before the
  // daily-cap matcher, whose quota wording would otherwise swallow it.
  const reason = extractGoogleReason(safeBody);
  const message = extractGoogleMessage(safeBody);
  if (reason === "storageQuotaExceeded") return DRIVE_STORAGE_FULL_MESSAGE;
  if (isDailyUploadCapSignal(status, safeBody)) return DRIVE_DAILY_CAP_MESSAGE;
  if (status === 413) return DRIVE_SINGLE_FILE_LIMIT_MESSAGE;
  if (message) {
    if (/storage quota/i.test(message)) return DRIVE_STORAGE_FULL_MESSAGE;
    if (/larger than.*max|exceeds.*(maximum|5\s?tb)/i.test(message)) {
      return DRIVE_SINGLE_FILE_LIMIT_MESSAGE;
    }
    return `Drive rejected the upload: ${message.slice(0, 200)}`;
  }
  return `Drive rejected the upload (HTTP ${status}). Please retry.`;
}

/**
 * Map any upload-path throw into an HTTP { status, message } for API
 * routes. Validation problems → 400, exhausted daily quota → 429,
 * oversized single file → 413, everything else → 502 with Drive's own
 * message text when Google supplied one (never a bare generic crash).
 */
export function uploadHttpError(err: unknown): {
  status: number;
  message: string;
} {
  if (err instanceof DriveValidationError) {
    const message = err.message.replace(/^\[drive\] /, "");
    if (/5\s?TB single-file/.test(message)) {
      return { status: 413, message };
    }
    if (/daily upload limit \(750/.test(message)) {
      return { status: 429, message };
    }
    return { status: 400, message };
  }
  const text = err instanceof Error ? err.message : "";
  const match = text.match(/\(HTTP (\d{3})\): ([\s\S]*)$/);
  const status = match ? Number(match[1]) : 0;
  const body = (match?.[2] ?? "").slice(0, 500);
  if (status === 403 || status === 429) {
    if (isDailyUploadCapSignal(status, body)) {
      return { status: 429, message: DRIVE_DAILY_CAP_MESSAGE };
    }
    const message = extractGoogleMessage(body);
    return {
      status: 502,
      message: message
        ? `Drive rejected the upload: ${message.slice(0, 200)}`
        : "Drive upload failed. Please try again.",
    };
  }
  if (status === 413) return { status: 413, message: DRIVE_SINGLE_FILE_LIMIT_MESSAGE };
  if (status >= 400 && status < 500) {
    return { status: 502, message: describeDriveApiError(status, body) };
  }
  return { status: 502, message: "Drive upload failed. Please try again." };
}

function driveError(action: string, status: number, body: string): Error {
  // Log status + Google's error summary, never tokens.
  return new Error(
    `[drive] ${action} failed (HTTP ${status}): ${body.slice(0, 300)}`
  );
}

/** Exchange the owner's refresh token for a short-lived access token.
 *
 * Large folder batches mint one resumable session PER FILE — without
 * caching, a 3k-file batch would pay 3k full OAuth exchanges (each a
 * serial HTTPS roundtrip) before a single byte moves. The token is cached
 * in-module with a 50-minute TTL (Google tokens live ~1h) keyed by the
 * credentials, so a whole batch costs ~1 exchange. Pure speedup: callers
 * cannot tell a cached token from a fresh one, and expiry is time-based.
 */
let tokenCache: {
  token: string;
  expiresAt: number;
  clientId: string;
  refreshToken: string;
} | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000;

export async function getDriveAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const now = Date.now();
  if (
    tokenCache &&
    tokenCache.clientId === clientId &&
    tokenCache.refreshToken === refreshToken &&
    now < tokenCache.expiresAt
  ) {
    return tokenCache.token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  } | null;
  if (!res.ok || typeof data?.access_token !== "string") {
    // A stale cached token must never poison later calls.
    tokenCache = null;
    throw driveError(
      "refresh access token",
      res.status,
      JSON.stringify({
        error: data?.error ?? null,
        error_description: data?.error_description ?? null,
      })
    );
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    clientId,
    refreshToken,
  };
  return data.access_token;
}

/** Find the workspace folder by name, creating it on first use. */
export async function ensureDriveFolder(
  accessToken: string,
  folderName: string = DRIVE_FOLDER_NAME
): Promise<string> {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`
  );
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const foundData = (await found.json().catch(() => null)) as {
    files?: { id?: string }[];
  } | null;
  if (!found.ok) {
    throw driveError("find folder", found.status, JSON.stringify(foundData));
  }
  const existingId = foundData?.files?.[0]?.id;
  if (existingId) return existingId;

  const created = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
    cache: "no-store",
  });
  const createdData = (await created.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  if (!created.ok || typeof createdData?.id !== "string") {
    throw driveError(
      "create folder",
      created.status,
      JSON.stringify(createdData)
    );
  }
  return createdData.id;
}

/** Multipart upload (metadata + bytes) strictly into the pre-assigned Drive folder. */
export async function uploadDriveFile(
  accessToken: string,
  args: {
    name: string;
    mimeType: string;
    bytes: Blob;
    folderId: string;
  }
): Promise<DriveFile> {
  if (!isValidDriveFileId(args.folderId)) {
    throw new Error(`[drive] Invalid destination folder ID (${args.folderId}).`);
  }
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          name: args.name,
          parents: [args.folderId],
        }),
      ],
      { type: "application/json" }
    )
  );
  form.append("file", args.bytes, args.name);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      cache: "no-store",
    }
  );
  const data = (await res.json().catch(() => null)) as DriveFile | null;
  if (!res.ok || !data?.id) {
    throw driveError("upload", res.status, JSON.stringify(data));
  }
  // Bytes landed server-side here (multipart path) — listings must refresh.
  invalidateDriveBrowseCache();
  return data;
}

export interface ResumableSession {
  /** Capability URL the browser PUTs bytes to (metadata already locked). */
  sessionUri: string;
  /** Sanitized file name the session was created with. */
  fileName: string;
  /** Deepest locked-root subfolder the bytes will land in. */
  parentFolderId: string;
  /** Top-level subfolder of this tree inside the locked root (null when the
   * file sits directly in the locked root). */
  topFolderId: string | null;
}

/**
 * Mint a resumable upload session for direct browser→Google byte transfer.
 *
 * Folder lock is enforced HERE, server-side: an optional client-reported
 * `relativePath` (e.g. "myproj/src/a.ts" from a folder pick or drop) is
 * sanitized and resolved into subfolders strictly INSIDE folderId, and the
 * session metadata pins parents=[deepestFolderId] — so bytes sent to the
 * session URI cannot land anywhere else no matter what the client does.
 * The session URI itself is a capability URL (no Google credentials travel
 * to the browser). Any file type and any size up to Drive's own 5 TB
 * ceiling is accepted.
 */
export async function createResumableUploadSession(
  accessToken: string,
  args: {
    name: string;
    mimeType: string;
    size: number;
    folderId: string;
    relativePath?: unknown;
  }
): Promise<ResumableSession> {
  const dest = resolveUploadDestination(
    args.relativePath,
    args.name,
    args.size
  );
  const { parentFolderId, topFolderId } = await ensureSubfolderPath(
    accessToken,
    args.folderId,
    dest.dirParts
  );
  const mimeType = args.mimeType || "application/octet-stream";
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(args.size),
      },
      body: JSON.stringify({
        name: dest.fileName,
        mimeType,
        parents: [parentFolderId],
      }),
      cache: "no-store",
    }
  );
  const sessionUri = res.headers.get("location");
  if (!res.ok || !sessionUri) {
    const body = await res.text().catch(() => "");
    throw driveError("create resumable session", res.status, body);
  }
  return {
    sessionUri,
    fileName: dest.fileName,
    parentFolderId,
    topFolderId,
  };
}

export interface VerifiedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  parents: string[];
}

/**
 * Re-read a file's metadata to PROVE it landed inside the locked folder.
 * Call this before recording any client-uploaded fileId (e.g. in Neon) —
 * a fileId pointing outside the folder (or to trash) is refused loudly.
 */
export async function verifyDriveFileInFolder(
  accessToken: string,
  fileId: string,
  folderId: string
): Promise<VerifiedDriveFile> {
  if (!isValidDriveFileId(fileId)) {
    throw new DriveValidationError(`[drive] Invalid file ID.`);
  }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=id,name,mimeType,size,parents,trashed`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const data = (await res.json().catch(() => null)) as {
    id?: unknown;
    name?: unknown;
    mimeType?: unknown;
    size?: unknown;
    parents?: unknown;
    trashed?: unknown;
  } | null;
  if (!res.ok || typeof data?.id !== "string") {
    throw driveError("verify uploaded file", res.status, JSON.stringify(data));
  }
  if (
    data.trashed ||
    !Array.isArray(data.parents) ||
    !data.parents.includes(folderId)
  ) {
    throw new DriveValidationError(
      "[drive] That file is not inside the designated upload folder — refusing to record it."
    );
  }
  return {
    id: data.id,
    name: typeof data.name === "string" ? data.name : "upload",
    mimeType:
      typeof data.mimeType === "string"
        ? data.mimeType
        : "application/octet-stream",
    size: typeof data.size === "string" ? data.size : "0",
    parents: data.parents as string[],
  };
}

/** Stream a file's bytes back (caller forwards status + headers). */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string
): Promise<Response> {
  return fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
}

/** List files in the workspace folder (metadata only, newest first). */
export async function listDriveFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const data = (await res.json().catch(() => null)) as {
    files?: DriveFile[];
  } | null;
  if (!res.ok || !Array.isArray(data?.files)) {
    throw driveError("list", res.status, JSON.stringify(data));
  }
  return data.files;
}

/** Extended file metadata for browser view — includes thumbnail & icon for previews. */
export interface DriveBrowseFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
  isFolder: boolean;
}

/** In-memory cache for browse results — avoids hammering Drive API on re-open. */
const browseCache = new Map<string, { at: number; files: DriveBrowseFile[] }>();
const BROWSE_CACHE_TTL_MS = 30_000;

/** List immediate children of a folder with preview-capable fields. Paginated server-side. */
export async function listDriveFolderContents(
  accessToken: string,
  folderId: string,
  opts?: { fresh?: boolean }
): Promise<DriveBrowseFile[]> {
  if (!opts?.fresh) {
    const cached = browseCache.get(folderId);
    if (cached && Date.now() - cached.at < BROWSE_CACHE_TTL_MS) {
      return cached.files;
    }
  } else {
    // Explicitly clear cache for this folder when fresh is requested
    browseCache.delete(folderId);
  }
  const files: DriveBrowseFile[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink,parents)&orderBy=folder,modifiedTime desc&pageSize=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as {
      files?: DriveBrowseFile[];
      nextPageToken?: string;
    } | null;
    if (!res.ok || !Array.isArray(data?.files)) {
      throw driveError("list folder contents", res.status, JSON.stringify(data));
    }
    for (const f of data.files) {
      files.push({
        ...f,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  browseCache.set(folderId, { at: Date.now(), files });
  return files;
}

/** Recursively list all files under a project folder (BFS), preserving relative paths. */
export async function listDriveTree(
  accessToken: string,
  rootFolderId: string,
  opts?: { fresh?: boolean }
): Promise<{ file: DriveBrowseFile; relativePath: string }[]> {
  const result: { file: DriveBrowseFile; relativePath: string }[] = [];
  // BFS queue: {folderId, prefix}
  const queue: { id: string; prefix: string }[] = [{ id: rootFolderId, prefix: "" }];
  const visited = new Set<string>([rootFolderId]);
  // Throttle: small delay between Drive list calls to respect rate limits
  const throttle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (queue.length > 0) {
    const { id, prefix } = queue.shift()!;
    const children = await listDriveFolderContents(accessToken, id, opts);
    for (const child of children) {
      const rel = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isFolder) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          queue.push({ id: child.id, prefix: rel });
        }
        // Don't add folders themselves to file list for zip — they will be
        // created implicitly via file paths, but we keep them for browser tree
        result.push({ file: child, relativePath: rel });
      } else {
        result.push({ file: child, relativePath: rel });
      }
    }
    if (queue.length > 0) await throttle(40); // ~25 list/sec max, respects rate limits
  }
  return result;
}

/** Fetch a small code/text snippet (first ~4KB) for preview — streaming, not full download. */
export async function getDriveFileSnippet(
  accessToken: string,
  fileId: string,
  maxBytes = 4096
): Promise<{ snippet: string; truncated: boolean }> {
  if (!isValidDriveFileId(fileId)) throw new DriveValidationError("[drive] Invalid file ID.");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Range: `bytes=0-${maxBytes - 1}`,
      },
      cache: "no-store",
    }
  );
  // 206 Partial Content or 200 OK both valid; 404 means not found
  if (res.status === 404) throw driveError("snippet not found", 404, "File not found");
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => "");
    throw driveError("snippet fetch", res.status, body);
  }
  const text = await res.text().catch(() => "");
  // If file larger than maxBytes, Drive may return truncated; we detect via Content-Range
  const contentRange = res.headers.get("content-range");
  const truncated = !!contentRange && contentRange.includes(`/${maxBytes}`) === false && text.length >= maxBytes;
  // Limit to first ~50 lines to keep preview readable
  const lines = text.slice(0, maxBytes).split("\n").slice(0, 50);
  return { snippet: lines.join("\n"), truncated: truncated || text.length >= maxBytes };
}

/** Permanently delete a file by ID. */
export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw driveError("delete", res.status, body);
  }
}

/**
 * Move a file or folder to Drive trash (recoverable via the Drive UI's
 * Trash — NOT a permanent delete). Used by the team Files browser; the
 * Projects flow keeps using permanent `deleteDriveFile` for published
 * bundles, so the two features never swap semantics.
 */
export async function trashDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  if (!isValidDriveFileId(fileId)) {
    throw new DriveValidationError("[drive] Invalid file ID.");
  }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw driveError("trash", res.status, body);
  }
  invalidateDriveBrowseCache();
}

/** Drop all cached folder listings (ids may have been trashed/uploaded). */
export function invalidateDriveBrowseCache(): void {
  browseCache.clear();
}

/**
 * Confirm a file/folder lives strictly inside a root folder by walking
 * the `parents` chain upward (Drive files have a single parent here —
 * everything is created with parents=[oneId]). Fail-closed: any lookup
 * failure, missing parents, or hop-limit exhaustion returns false.
 * Used before destructive actions so an id from outside the team space
 * can never be trashed through the app.
 */
export async function isDescendantOfFolder(
  accessToken: string,
  fileId: string,
  rootFolderId: string,
  maxHops = 25
): Promise<boolean> {
  if (!isValidDriveFileId(fileId) || !isValidDriveFileId(rootFolderId)) {
    return false;
  }
  let current: string | null = fileId;
  for (let hop = 0; hop < maxHops && current; hop++) {
    if (current === rootFolderId) return true;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(current)}?fields=id,parents,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    const data = (await res.json().catch(() => null)) as {
      parents?: unknown;
      trashed?: unknown;
    } | null;
    if (!res.ok || !data || data.trashed) return false;
    const parents = Array.isArray(data.parents)
      ? data.parents.filter((p): p is string => typeof p === "string")
      : [];
    // A parent inside the locked root is sufficient (single-parent trees).
    if (parents.includes(rootFolderId)) return true;
    current = parents[0] ?? null;
  }
  return current === rootFolderId;
}
