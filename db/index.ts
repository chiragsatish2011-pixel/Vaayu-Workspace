import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Stateless Postgres client for Vercel serverless functions.
 *
 * Uses Neon's HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`):
 * one HTTPS fetch per query, no TCP sockets, no connection pool, nothing
 * held open between invocations. Every API route that imports `db` stays
 * stateless and completes quickly.
 *
 * Build safety: `next build` must succeed even before DATABASE_URL is set
 * (e.g. CI, or a fresh clone). So we fall back to a placeholder string at
 * import time; any real query without DATABASE_URL will fail loudly at
 * runtime, which is the correct behavior.
 */
function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[db] DATABASE_URL is not set. Database queries will fail until it is configured."
      );
    }
    // Placeholder keeps `next build` / `drizzle-kit generate` working
    // without a live database. Never used for real queries.
    return "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  }
  return url;
}

const sql = neon(getConnectionString());

export const db = drizzle(sql, { schema });
