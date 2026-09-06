import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — generates SQL migrations from `db/schema.ts`
 * into `./drizzle`, applied to a fresh Neon Postgres database with:
 *
 *   npx drizzle-kit migrate
 *
 * (requires DATABASE_URL to be set). `generate` itself needs no live DB.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Fallback placeholder lets `drizzle-kit generate` run without a live
    // DB. `migrate` / `push` require the real DATABASE_URL.
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
