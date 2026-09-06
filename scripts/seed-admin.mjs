/**
 * Seed the first admin account (run once):
 *
 *   DATABASE_URL="postgresql://..." npm run db:seed
 *   # or with DATABASE_URL in .env.local: npm run db:seed
 *
 * Creates admin@vaayu.com / role "admin" if missing, or updates the
 * existing row to role "admin" with a fresh hash if present. Password is
 * bcrypt-hashed (cost 12) before storing — never plaintext, never logged.
 *
 * NOTE — placeholder credential: "1234" is intentionally weak, only so the
 * owner can see the app's inner pages right now. Change it immediately
 * after signing in, via Admin → Change password on your own row. Login
 * lowercases emails, so signing in as Admin@vaayu.com works.
 */
import bcrypt from "bcryptjs";
import { neon } from "@neondatabase/serverless";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });

const ADMIN_EMAIL = "admin@vaayu.com";
const ADMIN_PASSWORD = "1234";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim().length === 0) {
  throw new Error(
    "DATABASE_URL is not set. Add it in Vercel's Environment Variables settings for this environment (or .env.local for local runs)."
  );
}

const sql = neon(databaseUrl);

const existing =
  await sql`SELECT id, role FROM users WHERE email = ${ADMIN_EMAIL} LIMIT 1`;

const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

if (existing.length > 0) {
  await sql`UPDATE users SET password_hash = ${passwordHash}, role = 'admin' WHERE id = ${existing[0].id}`;
  console.log(
    `[seed-admin] updated existing account (${ADMIN_EMAIL}) to role admin`
  );
} else {
  const inserted =
    await sql`INSERT INTO users (email, password_hash, role) VALUES (${ADMIN_EMAIL}, ${passwordHash}, 'admin') RETURNING id, email`;
  console.log(
    `[seed-admin] created admin account (${inserted[0].email}) with id ${inserted[0].id}`
  );
}
console.log(
  "[seed-admin] done — change this placeholder password immediately via Admin → Change password."
);
