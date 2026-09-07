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

/** Upload constraints: Google Drive supports all file formats as a general store. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB per file limit

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
 */
export function sanitizeFileName(raw: string, fallbackExt: string): string {
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

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

/**
 * Validate an uploaded file for Drive storage:
 * - Accepts any file type Google Drive naturally supports (no artificial extension gating)
 * - Rejects empty (0-byte) or corrupted files
 * - Enforces max per-file size limits
 * - Sanitizes filename to prevent directory traversal
 */
export function validateUpload(
  originalName: string,
  size: number
): { name: string } | { error: string } {
  if (typeof size !== "number" || size <= 0) {
    return { error: "Cannot upload empty (0-byte) or corrupt files." };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return {
      error: `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB).`,
    };
  }
  const ext = extensionOf(originalName);
  return { name: sanitizeFileName(originalName, ext) };
}


function driveError(action: string, status: number, body: string): Error {
  // Log status + Google's error summary, never tokens.
  return new Error(
    `[drive] ${action} failed (HTTP ${status}): ${body.slice(0, 300)}`
  );
}

/** Exchange the owner's refresh token for a short-lived access token. */
export async function getDriveAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
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
    throw driveError(
      "refresh access token",
      res.status,
      JSON.stringify({
        error: data?.error ?? null,
        error_description: data?.error_description ?? null,
      })
    );
  }
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

/** Multipart upload (metadata + bytes) into the workspace folder. */
export async function uploadDriveFile(
  accessToken: string,
  args: {
    name: string;
    mimeType: string;
    bytes: Blob;
    folderId: string;
  }
): Promise<DriveFile> {
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
  return data;
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
