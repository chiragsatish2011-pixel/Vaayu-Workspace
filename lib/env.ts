/**
 * Central environment-variable validation (SERVER ONLY).
 *
 * Why this file exists: a missing DATABASE_URL / NEXTAUTH_SECRET /
 * NEXTAUTH_URL used to surface as a generic 500 deep inside some route,
 * or — worse — as a build-time warning that was easy to miss. These
 * helpers fail fast with a loud, actionable message naming exactly which
 * variable is missing.
 *
 * Build safety: `next build` must succeed even before env vars are set
 * (CI, fresh clone, Vercel build step). During the build phase
 * (`NEXT_PHASE === "phase-production-build"`) the helpers return a
 * placeholder instead of throwing. At runtime (dev, `next start`,
 * Vercel serverless) they throw immediately.
 *
 * Setup-wizard safety: the /setup flow intentionally runs WITHOUT a
 * database (step 1 collects DATABASE_URL). So global startup checks must
 * NOT throw for DATABASE_URL — instead, `db` throws lazily on first real
 * query, and /api/setup/* return structured 503s. NEXTAUTH checks live in
 * `lib/auth.ts` / `middleware.ts`, which /setup never imports.
 */

export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

const VERCEL_HINT =
  "Add it in Vercel's Environment Variables settings for this environment.";

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (isMissing(url)) {
    if (isBuildPhase()) {
      // Placeholder keeps `next build` / static analysis working without a
      // live database. Never used for real queries.
      return "postgresql://placeholder:placeholder@localhost:5432/placeholder";
    }
    throw new Error(
      `DATABASE_URL is not set. ${VERCEL_HINT}`
    );
  }
  return url as string;
}

export function requireNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (isMissing(secret)) {
    if (isBuildPhase()) {
      // Long placeholder — only to let `next build` collect routes.
      // Real sessions are never signed with this.
      return "build-phase-placeholder-secret-please-set-nextauth-secret-32-chars-min";
    }
    throw new Error(
      `NEXTAUTH_SECRET is not set. ${VERCEL_HINT}`
    );
  }
  return secret as string;
}

export function requireNextAuthUrl(): string {
  const url = process.env.NEXTAUTH_URL;
  if (isMissing(url)) {
    if (isBuildPhase()) {
      return "http://localhost:3000";
    }
    // NOTE: NextAuth can auto-detect Vercel preview URLs from request
    // headers, but we require an explicit value so a missing variable can
    // never silently break callbacks. Set it to your deployed URL
    // (e.g. https://YOUR-APP.vercel.app) in Vercel's dashboard.
    throw new Error(
      `NEXTAUTH_URL is not set. ${VERCEL_HINT}`
    );
  }
  return url as string;
}

/**
 * Validate all three at once — useful for API routes and auth paths that
 * need both a database and sessions. Throws the first missing variable.
 * NOT for /setup or build-time code (see note above).
 */
export function assertRequiredEnv(): {
  databaseUrl: string;
  nextAuthSecret: string;
  nextAuthUrl: string;
} {
  const databaseUrl = requireDatabaseUrl();
  const nextAuthSecret = requireNextAuthSecret();
  const nextAuthUrl = requireNextAuthUrl();
  return { databaseUrl, nextAuthSecret, nextAuthUrl };
}
