import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

/**
 * First-run setup helpers (SERVER ONLY — never import from client code).
 *
 * Everything the /setup wizard needs: probe whether the workspace is ready,
 * test a pasted database URL, create the tables, create the first (admin)
 * account, and — in local dev only — persist DATABASE_URL to `.env.local`
 * so the owner never touches a terminal or an env dashboard.
 */

export interface SetupStatus {
  /** A DATABASE_URL string is configured (may still be unreachable). */
  configured: boolean;
  /** The configured URL actually connects. */
  reachable: boolean;
  /** The `users` table exists. */
  tables: boolean;
  /** At least one admin account exists. */
  admin: boolean;
  /**
   * True once ANY user exists (SELECT COUNT(*) FROM users > 0).
   * This is the self-disable switch for the one-time /setup wizard —
   * see getSetupStatus() below.
   */
  hasUsers: boolean;
  /** True on Vercel / production builds — file writes are refused there. */
  isProduction: boolean;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function clientFor(url: string) {
  return drizzle(
    neon(url, {
      fetchOptions: { signal: AbortSignal.timeout(12000) },
    })
  );
}

type Row = Record<string, unknown>;

async function probeRows(
  url: string,
  statement: string
): Promise<Row[] | null> {
  try {
    const res = (await clientFor(url).execute(sql.raw(statement))) as unknown;
    // drizzle's execute() shape varies (bare rows array vs. full result
    // object with `.rows`) depending on driver/bundler — accept both.
    const rows = Array.isArray(res)
      ? (res as Row[])
      : ((res as { rows?: unknown }).rows ?? null);
    return Array.isArray(rows) ? (rows as Row[]) : null;
  } catch {
    return null;
  }
}

export async function testDatabaseUrl(url: string): Promise<boolean> {
  const rows = await probeRows(url, "SELECT 1 AS ok");
  return rows?.[0]?.ok === 1;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const url = process.env.DATABASE_URL ?? null;
  const status: SetupStatus = {
    configured: !!url,
    reachable: false,
    tables: false,
    admin: false,
    hasUsers: false,
    isProduction: isProduction(),
  };
  if (!url) return status;

  if (!(await testDatabaseUrl(url))) return status;
  status.reachable = true;

  const tbl = await probeRows(
    url,
    "SELECT to_regclass('public.users') AS tbl"
  );
  if (!tbl?.[0]?.tbl) return status;
  status.tables = true;

  // ONE-TIME SETUP GATE — this is NOT a public sign-up path.
  // The /setup wizard exists only to bootstrap the very first account on a
  // fresh database (zero users). The moment ANY user exists (COUNT(*) > 0),
  // /setup must self-disable permanently and redirect to /signin — even if
  // someone knows the URL — so it can never hijack a live workspace or be
  // abused as open registration. We check COUNT(*) (any user), not just
  // admins, so deleting the admin or leaving only members still keeps setup
  // locked. `admin` is kept separately for dashboard UX (owner exists?).
  const cnt = await probeRows(url, "SELECT COUNT(*) AS cnt FROM users");
  const rawCnt = cnt?.[0]?.cnt;
  const count =
    typeof rawCnt === "number"
      ? rawCnt
      : typeof rawCnt === "string"
        ? parseInt(rawCnt, 10)
        : 0;
  status.hasUsers = Number.isFinite(count) && count > 0;

  const adm = await probeRows(
    url,
    "SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS adm"
  );
  status.admin = adm?.[0]?.adm === true;
  // Belt-and-braces: if any user exists but the admin check misfires,
  // treat setup as done — never leave the wizard open on a live DB.
  if (status.hasUsers) {
    // `admin` stays as queried for display; `hasUsers` is the lock.
  }
  return status;
}

/** Mirrors drizzle/0000 + 0001 + 0003, hardened to be safely re-runnable. */
const EMBEDDED_BOOTSTRAP = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
  `DO $$ BEGIN CREATE TYPE "public"."role" AS ENUM('admin', 'member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"display_name" text,
	"avatar_drive_id" text,
	"avatar_file_name" text,
	"has_completed_onboarding" boolean DEFAULT false NOT NULL,
	"department" text,
	"job_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);`,
  `CREATE TABLE IF NOT EXISTS "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"codebase_drive_id" text NOT NULL,
	"codebase_file_name" text NOT NULL,
	"codebase_file_size" text NOT NULL,
	"preview_drive_id" text,
	"preview_file_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `DO $$ BEGIN CREATE TYPE "call_type" AS ENUM('voice', 'video'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "call_context" AS ENUM('standalone', 'project', 'checkpoint'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "call_type" NOT NULL,
	"context" "call_context" DEFAULT 'standalone' NOT NULL,
	"context_id" text,
	"daily_room_name" text NOT NULL UNIQUE,
	"daily_room_url" text NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"content" text NOT NULL,
	"content_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);`,
];

async function loadBootstrapStatements(): Promise<string[]> {
  // Apply every migration file in order, so fresh wizard databases always
  // end up on the current schema even as new migrations are added.
  try {
    const dir = path.join(process.cwd(), "drizzle");
    const files = (await readdir(dir))
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    const parts: string[] = [];
    for (const f of files) {
      const content = await readFile(path.join(dir, f), "utf8");
      for (const s of content.split("--> statement-breakpoint")) {
        const stmt = s.trim();
        if (stmt) parts.push(stmt);
      }
    }
    if (parts.length > 0) return parts;
  } catch {
    /* files not bundled (e.g. serverless) — fall through to embedded copy */
  }
  return EMBEDDED_BOOTSTRAP;
}

/**
 * Create the tables. Refuses when they already exist (idempotent guard),
 * so hitting this twice — or by accident — can never wipe data.
 */
export async function runBootstrap(
  url: string
): Promise<{ applied: boolean; already: boolean }> {
  const tbl = await probeRows(
    url,
    "SELECT to_regclass('public.users') AS tbl"
  );
  if (tbl?.[0]?.tbl) {
    // Table already exists — ensure new profile/onboarding columns exist
    // (added after initial launch). IF NOT EXISTS makes this safe to re-run.
    const db = clientFor(url);
    const alters = [
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_drive_id" text`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_file_name" text`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean DEFAULT false NOT NULL`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department" text`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "job_title" text`,
      `DO $$ BEGIN CREATE TYPE "call_type" AS ENUM('voice', 'video'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN CREATE TYPE "call_context" AS ENUM('standalone', 'project', 'checkpoint'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `CREATE TABLE IF NOT EXISTS "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "call_type" NOT NULL,
	"context" "call_context" DEFAULT 'standalone' NOT NULL,
	"context_id" text,
	"daily_room_name" text NOT NULL UNIQUE,
	"daily_room_url" text NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
)`,
      `CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"content" text NOT NULL,
	"content_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);`,
    ];
    for (const stmt of alters) {
      try {
        await db.execute(sql.raw(stmt));
      } catch {
        /* ignore — column may already exist or permission issue will surface elsewhere */
      }
    }
    return { applied: false, already: true };
  }

  const db = clientFor(url);
  for (const stmt of await loadBootstrapStatements()) {
    await db.execute(sql.raw(stmt));
  }
  return { applied: true, already: false };
}

function escapeEnvValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Persist keys to `.env.local` (LOCAL DEV ONLY — refused in production,
 * where env vars belong in the Vercel dashboard). Next.js reloads
 * `.env.local` automatically, so the wizard just polls status afterwards.
 */
export async function saveDevEnv(
  vars: Record<string, string>
): Promise<void> {
  if (isProduction()) {
    throw new Error(
      "Cannot write env files in production. Set variables in the Vercel dashboard instead."
    );
  }
  const file = path.join(process.cwd(), ".env.local");
  let content = "";
  try {
    content = await readFile(file, "utf8");
  } catch {
    content =
      "# Vaayu Workspace · local dev (written by the /setup wizard)\n";
  }
  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${escapeEnvValue(value)}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    content = re.test(content)
      ? content.replace(re, line)
      : `${content}${line}\n`;
  }
  await writeFile(file, content, "utf8");
}
