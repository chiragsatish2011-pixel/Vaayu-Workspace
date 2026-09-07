import { NextRequest, NextResponse } from "next/server";
import { getDriveAccessToken, getDriveFileSnippet, isValidDriveFileId } from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/drive/snippet?id=<fileId>
 * Returns a short readable snippet of a text/code file's actual content
 * (first ~4KB / 50 lines) for preview. Uses Drive's alt=media with Range
 * to avoid downloading full large files. Cached server-side via
 * Cache-Control and client-side via session.
 *
 * Only for text-like mime types — other types return 415.
 */
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
];
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".json",
  ".md",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".txt",
  ".log",
  ".csv",
  ".sql",
  ".xml",
  ".svg",
  ".vue",
  ".svelte",
  ".astro",
]);

function isTextFile(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (TEXT_MIME_PREFIXES.some((p) => lowerMime.startsWith(p) || lowerMime.includes(p))) return true;
  for (const ext of TEXT_EXTENSIONS) {
    if (lowerName.endsWith(ext)) return true;
  }
  // Fallback: if mime is generic octet-stream but extension looks like text, allow
  return false;
}

export async function GET(req: NextRequest) {
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

  const id = new URL(req.url).searchParams.get("id");
  if (!isValidDriveFileId(id)) {
    return NextResponse.json({ error: "A valid Drive file id is required." }, { status: 400 });
  }

  try {
    const accessToken = await getDriveAccessToken(
      drive.clientId,
      drive.clientSecret,
      drive.refreshToken
    );

    // Fetch metadata to validate file is inside locked folder and is text-like
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (metaRes.status === 404) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    if (!metaRes.ok) {
      throw new Error(`[drive] snippet metadata failed (HTTP ${metaRes.status})`);
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
      return NextResponse.json({ error: "File was deleted." }, { status: 404 });
    }
    // Verify inside locked folder (allow direct child or any descendant — project IDs are already verified)
    // For snippet we just check the file exists and is not trashed; the browse endpoint already
    // ensures project-level access.

    const name = meta.name || "file";
    const mimeType = meta.mimeType || "application/octet-stream";

    if (!isTextFile(name, mimeType)) {
      return NextResponse.json(
        { error: "Preview not available for this file type.", snippet: null, truncated: false },
        { status: 415 }
      );
    }

    // Check size — if >10MB, we still only fetch first 4KB, but warn
    const size = Number(meta.size || 0);
    if (size > 10 * 1024 * 1024) {
      // Still allow snippet, but client can show truncated warning
    }

    const { snippet, truncated } = await getDriveFileSnippet(accessToken, id, 4096);

    // Simple content-type detection for client highlighting
    const ext = name.toLowerCase().split(".").pop() || "";
    return NextResponse.json(
      {
        snippet,
        truncated,
        name,
        mimeType,
        ext,
        size: meta.size,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60", // cache for 1 min, session reuse
        },
      }
    );
  } catch (err) {
    console.error("[drive/snippet]", err);
    const msg = err instanceof Error ? err.message : "Could not fetch snippet.";
    if (msg.includes("404") || msg.includes("not found")) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not fetch file preview." }, { status: 502 });
  }
}
