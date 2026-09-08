import { NextRequest, NextResponse } from "next/server";
import { ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { getCheckpoints } from "@/lib/checkpoints-store";
import { requireApiSession } from "@/lib/session";
import { getDriveAccessToken, listDriveFolderContents } from "@/lib/drive";
import { assertDriveEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Normalized {
  type: "person" | "project" | "file" | "folder" | "checkpoint";
  id: string;
  label: string;
  sublabel: string;
  // extra for rendering (person avatar/color)
  email?: string;
  avatarDriveId?: string | null;
  displayName?: string | null;
}

// Simple in-memory cache per query (30s)
const cache = new Map<string, { at: number; data: Normalized[] }>();
const CACHE_TTL = 30_000;

export async function GET(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  // Empty query (just "@") should show recent/top items, not empty — so we allow empty and search without filter
  const isEmpty = !q;

  const cacheKey = q;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return NextResponse.json({ results: cached.data });
  }

  const results: Normalized[] = [];

  // Fan out — isEmpty means no filter, just top recent
  const [people, proj, checkpoints, files] = await Promise.all([
    searchPeople(q, isEmpty),
    searchProjects(q, isEmpty),
    searchCheckpoints(q, isEmpty),
    searchFiles(q, isEmpty).catch(() => [] as Normalized[]),
  ]);

  // Grouped: people first, then projects, files, checkpoints — limit 5 each for popup brevity
  results.push(...people.slice(0, 5), ...proj.slice(0, 5), ...files.slice(0, 5), ...checkpoints.slice(0, 5));

  // Recency bias: checkpoints/projects already sorted newest first, so they naturally bias recent
  cache.set(cacheKey, { at: Date.now(), data: results });
  if (cache.size > 100) cache.clear();

  return NextResponse.json({ results });
}

async function searchPeople(q: string, isEmpty: boolean): Promise<Normalized[]> {
  try {
    if (isEmpty) {
      const rows = await db.select({ id: users.id, displayName: users.displayName, email: users.email, avatarDriveId: users.avatarDriveId }).from(users).limit(5);
      return rows.map((u) => ({
        type: "person" as const,
        id: u.id,
        label: u.displayName || u.email.split("@")[0] || u.email,
        sublabel: u.email,
        email: u.email,
        avatarDriveId: u.avatarDriveId,
        displayName: u.displayName,
      }));
    }
    const rows = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email, avatarDriveId: users.avatarDriveId })
      .from(users)
      .where(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)))
      .limit(10);
    return rows.map((u) => ({
      type: "person" as const,
      id: u.id,
      label: u.displayName || u.email.split("@")[0] || u.email,
      sublabel: u.email,
      email: u.email,
      avatarDriveId: u.avatarDriveId,
      displayName: u.displayName,
    }));
  } catch {
    return [];
  }
}

async function searchProjects(q: string, isEmpty: boolean): Promise<Normalized[]> {
  try {
    if (isEmpty) {
      const rows = await db.select({ id: projects.id, title: projects.title }).from(projects).limit(5);
      return rows.map((p) => ({ type: "project" as const, id: p.id, label: p.title, sublabel: "Project" }));
    }
    const rows = await db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(or(ilike(projects.title, `%${q}%`), ilike(projects.description, `%${q}%`)))
      .limit(10);
    return rows.map((p) => ({
      type: "project" as const,
      id: p.id,
      label: p.title,
      sublabel: "Project",
    }));
  } catch {
    return [];
  }
}

async function searchCheckpoints(q: string, isEmpty: boolean): Promise<Normalized[]> {
  try {
    const all = await getCheckpoints();
    const filtered = isEmpty ? all.slice(0, 5) : all.filter((c) => c.note.toLowerCase().includes(q) || (c.displayName && c.displayName.toLowerCase().includes(q))).slice(0, 10);
    return filtered.map((c) => ({
      type: "checkpoint" as const,
      id: c.id,
      label: c.note.slice(0, 60) + (c.note.length > 60 ? "…" : ""),
      sublabel: `Checkpoint · ${c.userEmail}`,
    }));
  } catch {
    return [];
  }
}

async function searchFiles(q: string, isEmpty: boolean): Promise<Normalized[]> {
  // Best-effort Drive listing — if Drive not configured, return empty
  try {
    const drive = assertDriveEnv();
    const token = await getDriveAccessToken(drive.clientId, drive.clientSecret, drive.refreshToken);
    const files = await listDriveFolderContents(token, drive.folderId);
    const filtered = isEmpty ? files.slice(0, 5) : files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 10);
    return filtered.map((f) => ({
      type: f.isFolder ? ("folder" as const) : ("file" as const),
      id: f.id,
      label: f.name,
      sublabel: f.isFolder ? "Folder" : f.mimeType.split("/").pop() || "File",
    }));
  } catch {
    return [];
  }
}
