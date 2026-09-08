import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { isBuildPhase } from "@/lib/env";

/**
 * Stateless Postgres client for Vercel serverless functions.
 *
 * Uses Neon's HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`):
 * one HTTPS fetch per query, no TCP sockets, no connection pool, nothing
 * held open between invocations. Every API route that imports `db` stays
 * stateless and completes quickly.
 *
 * Fail-fast: if DATABASE_URL is missing or empty at runtime, ANY use of
 * `db` throws immediately:
 *   "DATABASE_URL is not set. Add it in Vercel's Environment Variables
 *    settings for this environment."
 * This is intentionally lazy (a Proxy) rather than throwing at import time,
 * so:
 *  - `next build` still succeeds (build phase gets a placeholder), and
 *  - the /setup wizard (which runs WITHOUT a database on step 1) can still
 *    render and return structured 503s instead of crashing on import.
 */

const PLACEHOLDER_URL =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

function createClient(url: string) {
  const sql = neon(url);
  return drizzle(sql, { schema });
}

type DbClient = ReturnType<typeof createClient>;

let cached: DbClient | null = null;
let cachedUrl: string | null = null;

function missingDatabaseError(): Error {
  return new Error(
    "DATABASE_URL is not set. Add it in Vercel's Environment Variables settings for this environment."
  );
}

function resolveClient(): DbClient {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    if (isBuildPhase()) {
      if (!cached || cachedUrl !== PLACEHOLDER_URL) {
        cached = createClient(PLACEHOLDER_URL);
        cachedUrl = PLACEHOLDER_URL;
      }
      return cached;
    }
    throw missingDatabaseError();
  }
  if (!cached || cachedUrl !== url) {
    cached = createClient(url);
    cachedUrl = url;
  }
  return cached;
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop) {
    const client = resolveClient();
    const value = (client as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  // Support `Object.keys(db)` / spreads without triggering a throw during
  // build-time inspection — real query paths go through `get` above.
  has(_target, prop) {
    return prop in resolveClient();
  },
});
