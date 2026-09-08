import { NextRequest, NextResponse } from "next/server";
import { getDriveAccessToken, isDescendantOfFolder, isValidDriveFileId, listDriveTree, downloadDriveFile } from "@/lib/drive";
// archiver is CJS — use require inside handler to avoid Turbopack static export error
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getArchiver = () => {
  const mod = require("archiver") as unknown as
    | ((format: string, opts?: unknown) => import("archiver").Archiver)
    | { create: (format: string, opts?: unknown) => import("archiver").Archiver; Archiver: new (format: string, opts?: unknown) => import("archiver").Archiver };
  if (typeof mod === "function") return mod as (format: string, opts?: unknown) => import("archiver").Archiver;
  const m = mod as unknown as { create?: (format: string, opts?: unknown) => import("archiver").Archiver; Archiver?: new (format: string, opts?: unknown) => import("archiver").Archiver };
  if (typeof m.create === "function") return m.create.bind(m) as (format: string, opts?: unknown) => import("archiver").Archiver;
  // @ts-ignore - Archiver class exists at runtime
  if (m.Archiver) return (format: string, opts?: unknown) => new (m as unknown as { Archiver: new (format: string, opts?: unknown) => import("archiver").Archiver }).Archiver(format, opts);
  throw new Error("Could not load archiver");
};
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow up to 5 min for large zips (Vercel max)

/**
 * POST /api/drive/zip
 * Streams a folder or selection as a single .zip.
 * Body: { id?: string, ids?: string[], name?: string }
 * - id: single folder/file id (whole project/folder download)
 * - ids: array of file/folder ids for multi-select
 *
 * For folders, recursively lists all descendants (via listDriveTree) and
 * streams each file's bytes from Drive into the zip, streaming the zip
 * out to the browser without buffering entire project in memory.
 *
 * Large scale: uses archiver with streaming, concurrency-limited fetches
 * (2 at a time) with backoff on 403/429, and reports partial failures
 * in the zip comment rather than silently producing corrupt zip.
 */

interface ZipRequestBody {
  id?: string;
  ids?: string[];
  name?: string;
}

// Simple concurrency limiter
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      await fn(item, i);
    }
  });
  await Promise.all(workers);
}

// Throttle helper for rate limits
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let drive;
  try {
    drive = assertDriveEnv();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  let body: ZipRequestBody;
  try {
    body = (await req.json()) as ZipRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON. Send { id } or { ids: [] }." }, { status: 400 });
  }

  const singleId = typeof body.id === "string" ? body.id : null;
  const multiIds = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") as string[] : null;
  const requestedIds = singleId ? [singleId] : multiIds && multiIds.length > 0 ? multiIds : null;

  if (!requestedIds || requestedIds.length === 0) {
    return NextResponse.json({ error: "Provide { id: <Drive id> } or { ids: [<ids>] }." }, { status: 400 });
  }

  // Validate all IDs format
  for (const id of requestedIds) {
    if (!isValidDriveFileId(id)) {
      return NextResponse.json({ error: `Invalid Drive file id: ${id}` }, { status: 400 });
    }
  }

  // Limit multi-select to avoid abuse (e.g., 500 items max)
  if (requestedIds.length > 500) {
    return NextResponse.json({ error: "Too many items selected (max 500). Please select fewer." }, { status: 400 });
  }

  const zipNameRaw = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "download";
  const zipName = zipNameRaw.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";

  try {
    const accessToken = await getDriveAccessToken(drive.clientId, drive.clientSecret, drive.refreshToken);

    // Gather all files to zip — for each requested ID, if it's a folder, expand recursively
    const allFiles: { id: string; name: string; mimeType: string; relativePath: string; size?: string }[] = [];
    let totalBytes = 0;
    let fileCount = 0;
    const seenIds = new Set<string>();

    for (const reqId of requestedIds) {
      // Fetch metadata to determine if folder or file
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(reqId)}?fields=id,name,mimeType,size,parents,trashed`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
      if (metaRes.status === 404) {
        return NextResponse.json({ error: `File or folder not found: ${reqId}` }, { status: 404 });
      }
      if (!metaRes.ok) {
        const body = await metaRes.text().catch(() => "");
        throw new Error(`[drive] zip metadata failed (HTTP ${metaRes.status}): ${body.slice(0, 200)}`);
      }
      const meta = (await metaRes.json()) as {
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        parents?: string[];
        trashed?: boolean;
      };
      if (meta.trashed) {
        return NextResponse.json({ error: `File or folder was deleted: ${reqId}` }, { status: 404 });
      }
      // Folder-lock: requested id must be inside team folder
      if (reqId !== drive.folderId) {
        const inside = await isDescendantOfFolder(accessToken, reqId, drive.folderId);
        if (!inside && !(Array.isArray(meta.parents) && meta.parents.includes(drive.folderId))) {
          return NextResponse.json({ error: `File or folder is not inside the team folder: ${reqId}` }, { status: 403 });
        }
      }
      const isFolder = meta.mimeType === "application/vnd.google-apps.folder";
      if (isFolder) {
        // Recursively list tree
        const tree = await listDriveTree(accessToken, reqId);
        // For multi-select of folders, we want to preserve top-level folder name as prefix
        // listDriveTree returns relativePath like "subfolder/file.txt" relative to requested folder
        // We prefix with folder name itself for multi-select clarity
        const prefix = requestedIds.length > 1 ? (meta.name || "folder") : "";
        for (const { file, relativePath } of tree) {
          if (file.isFolder) continue; // folders are created implicitly via file paths
          if (seenIds.has(file.id)) continue;
          seenIds.add(file.id);
          const finalPath = prefix ? `${prefix}/${relativePath}` : relativePath;
          allFiles.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            relativePath: finalPath,
            size: file.size,
          });
          const sz = Number(file.size || 0);
          if (Number.isFinite(sz)) totalBytes += sz;
          fileCount++;
        }
        // If folder is empty, we still want to create an empty folder entry in zip
        // archiver will handle empty zip case; we add a placeholder
        if (tree.length === 0) {
          // No files — zip will be empty but we still stream one
        }
      } else {
        if (seenIds.has(reqId)) continue;
        seenIds.add(reqId);
        const rel = meta.name || "file";
        // For multi-select, prefix with nothing — just file name; for single file, same
        allFiles.push({
          id: reqId,
          name: meta.name || "file",
          mimeType: meta.mimeType || "application/octet-stream",
          relativePath: rel,
          size: meta.size,
        });
        const sz = Number(meta.size || 0);
        if (Number.isFinite(sz)) totalBytes += sz;
        fileCount++;
      }
    }

    // Warning for extremely large — but we still stream; client already confirmed via UI
    // If totalBytes is huge, we proceed but streaming ensures no OOM.
    // Hard cutoff: if > 2GB or > 50000 files, we could reject, but spec says warn not silent.
    // We will allow up to Drive's limits, but log a warning.

    // Create streaming zip — use Node PassThrough and convert to Web stream for Response
    // This streams without buffering entire zip in memory (critical for 27k files / multi-GB)
    const { PassThrough } = await import("node:stream");
    const { Readable } = await import("node:stream");
    const archiver = getArchiver();
    const archive = archiver("zip", { zlib: { level: 1 } }); // level 1 for speed on large
    const pass = new PassThrough();
    archive.pipe(pass as unknown as NodeJS.WritableStream);

    // Track failures for summary
    const failedFiles: { path: string; error: string }[] = [];
    let processedFiles = 0;

    // Convert Node PassThrough to Web ReadableStream for NextResponse
    const readable = Readable.toWeb(pass as unknown as import("node:stream").Readable) as unknown as ReadableStream<Uint8Array>;

    // Start archiving in background
    (async () => {
      // For each file, fetch from Drive and append to zip
      // Use limited concurrency to respect rate limits
      const concurrency = 3; // 3 parallel Drive fetches max
      let throttleDelay = 0;

      const appendFile = async (f: (typeof allFiles)[0]) => {
        // Backoff if we hit rate limit previously
        if (throttleDelay > 0) await sleep(throttleDelay);
        let attempt = 0;
        while (attempt < 3) {
          try {
            const dlRes = await downloadDriveFile(accessToken, f.id);
            if (dlRes.status === 404) {
              throw new Error(`File not found in Drive: ${f.relativePath}`);
            }
            if (!dlRes.ok || !dlRes.body) {
              // Check for rate limit
              const status = dlRes.status;
              if (status === 403 || status === 429) {
                const body = await dlRes.text().catch(() => "");
                // Use same logic as drive.ts for daily cap vs retryable rate limit
                if (body.includes("rateLimitExceeded") || body.includes("userRateLimitExceeded")) {
                  throttleDelay = Math.min(5000, 1000 * Math.pow(2, attempt));
                  attempt++;
                  await sleep(throttleDelay);
                  continue;
                }
              }
              const body = await dlRes.text().catch(() => "");
              throw new Error(`[drive] download for zip failed (HTTP ${status}): ${body.slice(0, 200)}`);
            }

            // Convert Web ReadableStream to Node Readable for archiver
            const webStream = dlRes.body as unknown as ReadableStream<Uint8Array>;
            const nodeStream: unknown = (Readable as unknown as { fromWeb?: (s: unknown) => unknown }).fromWeb
              ? (Readable as unknown as { fromWeb: (s: unknown) => unknown }).fromWeb(webStream as unknown as never)
              : webStream;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (archive as unknown as { append: (s: unknown, o: unknown) => void }).append(nodeStream as unknown as never, { name: f.relativePath });
            processedFiles++;
            // Reset throttle on success
            throttleDelay = Math.max(0, throttleDelay - 200);
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("rateLimit") && attempt < 2) {
              throttleDelay = Math.min(5000, 1000 * Math.pow(2, attempt));
              attempt++;
              await sleep(throttleDelay);
              continue;
            }
            // Non-retryable or out of retries — record as failed, add entry note in zip
            failedFiles.push({ path: f.relativePath, error: msg.slice(0, 200) });
            // Add a placeholder text file indicating failure, so zip is not silently incomplete
            archive.append(`Failed to include ${f.relativePath}: ${msg}\n`, { name: `__FAILED__/${f.relativePath}.error.txt` });
            processedFiles++;
            return;
          }
        }
      };

      // Process files sequentially with limited concurrency to avoid OOM and rate limits
      await withConcurrency(allFiles, concurrency, async (f) => {
        await appendFile(f);
      });

      // If we had failures, add a summary file
      if (failedFiles.length > 0) {
        const summary = `Download completed with ${failedFiles.length} file(s) failed out of ${fileCount}:\n` +
          failedFiles.map((f) => `- ${f.path}: ${f.error}`).join("\n") +
          `\n\nTotal requested: ${fileCount} files, ${totalBytes} bytes\nSucceeded: ${fileCount - failedFiles.length}\nFailed: ${failedFiles.length}\n`;
        archive.append(summary, { name: "__FAILED__/SUMMARY.txt" });
      }

      // Finalize archive (no more files)
      await archive.finalize();
    })().catch((err) => {
      console.error("[drive/zip] background archive error", err);
      try { archive.abort(); } catch {}
      try { (pass as unknown as { destroy: (e: unknown) => void }).destroy(err); } catch {}
    });

    // Determine zip filename
    const safeZipName = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
    const encodedName = encodeURIComponent(safeZipName).replace(/'/g, "%27");

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeZipName}"; filename*=UTF-8''${encodedName}`,
        // Let browser show progress via Content-Length? We don't know final zip size upfront (streaming),
        // so we use chunked transfer. Client will show indeterminate progress but we also send
        // totalBytes/fileCount in headers for client-side warning/progress estimation.
        "X-Total-Files": String(fileCount),
        "X-Total-Bytes": String(totalBytes),
        "X-Failed-Files": String(0), // will be updated after? For now 0, summary inside zip handles failures
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[drive/zip]", err);
    const msg = err instanceof Error ? err.message : "Zip creation failed.";
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 502 });
  }
}

// Also support GET for single id convenience (e.g., Download all button uses GET with ?id=)
export async function GET(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const name = url.searchParams.get("name") || undefined;
  if (!id || !isValidDriveFileId(id)) {
    return NextResponse.json({ error: "A valid Drive file/folder id is required." }, { status: 400 });
  }
  // Reuse POST logic by creating a mock request
  const mockReq = {
    json: async () => ({ id, name }),
  } as unknown as NextRequest;
  // Instead of duplicating, call POST with constructed body
  // We'll just forward to POST handler logic inline — simpler to handle GET directly
  let drive;
  try {
    drive = assertDriveEnv();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  try {
    const accessToken = await getDriveAccessToken(drive.clientId, drive.clientSecret, drive.refreshToken);
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (metaRes.status === 404) {
      return NextResponse.json({ error: "File or folder not found." }, { status: 404 });
    }
    if (!metaRes.ok) {
      return NextResponse.json({ error: "Could not fetch file metadata." }, { status: 502 });
    }
    const meta = (await metaRes.json()) as { id?: string; name?: string; mimeType?: string; size?: string; trashed?: boolean };
    if (meta.trashed) {
      return NextResponse.json({ error: "File or folder was deleted." }, { status: 404 });
    }
    const isFolder = meta.mimeType === "application/vnd.google-apps.folder";
    if (!isFolder) {
      // Single file — redirect to download endpoint for direct streaming (no zip needed)
      // But for consistency, we can still zip single file or just redirect
      // We'll redirect to download
      const downloadUrl = `/api/drive/download?id=${encodeURIComponent(id)}`;
      return NextResponse.redirect(new URL(downloadUrl, req.url), 302);
    }
    // For folder, proceed with POST logic by calling POST handler via internal fetch
    // Instead, we will directly implement zip streaming for GET folder case (duplicate logic)
    // To avoid duplication, we will just return a JSON with instructions to use POST
    // But for simplicity, we handle folder zip via same streaming as POST
    // We'll reuse the POST implementation by creating a new Request

    // Create a new POST request object and call the POST function
    const postReq = new NextRequest(new URL(req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    // Preserve session cookies
    for (const [k, v] of req.headers.entries()) {
      if (k.toLowerCase() === "cookie") {
        postReq.headers.set(k, v);
      }
    }
    return POST(postReq);
  } catch (err) {
    console.error("[drive/zip][GET]", err);
    return NextResponse.json({ error: "Zip creation failed." }, { status: 502 });
  }
}
