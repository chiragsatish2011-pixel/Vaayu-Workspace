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
  // TEMPORARY DIAGNOSTIC for the Vercel NO_SECRET investigation — logs
  // presence only (never the value). REMOVE after confirming in Vercel
  // Function logs whether the Node runtime sees the variable. Expected:
  //   [env][node] NEXTAUTH_SECRET present: true
  console.log(
    `[env][node] NEXTAUTH_SECRET present: ${!isMissing(secret)}`
  );
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
  // TEMPORARY BUILD DIAGNOSTIC for the malformed-NEXTAUTH_URL prerender
  // failure (`Invalid URL` at app/providers.tsx:3). A URL is not a secret,
  // so printing the raw value is safe. REMOVE once the dashboard value is
  // corrected and the build is green.
  console.log(
    `[env][build-debug] NEXTAUTH_URL raw value: ${JSON.stringify(url ?? null)}`
  );
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
  // Validity: next-auth parses this with `new URL()` at module scope
  // (next-auth/react, imported by app/providers.tsx:3), so a value with an
  // internal space or other illegal host character throws ERR_INVALID_URL
  // during prerender/SSR. Mirror next-auth's own rule (prepend https://
  // when no scheme) and fail here with the offending value named — far
  // clearer than the deep prerender trace. Unlike a missing value (which
  // keeps a build-phase placeholder for CI/setup flows), a malformed value
  // is never usable, so this throws in every phase.
  try {
    const candidate =
      (url as string).startsWith("http") ? (url as string) : `https://${url}`;
    new URL(candidate);
  } catch {
    throw new Error(
      `NEXTAUTH_URL is malformed (${JSON.stringify(url)}). It must be a valid URL like https://your-app.vercel.app with no spaces or extra characters. Fix it in Vercel's Environment Variables settings for this environment.`
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

/**
 * Google Drive backend variables (SERVER ONLY — never NEXT_PUBLIC_).
 *
 * Enforced ONLY at the Drive layer: every /api/drive/* route and the
 * /admin/drive-setup OAuth flow calls these first, so a missing value
 * fails loudly naming exactly which variable is absent. They are NOT
 * checked globally at startup — the rest of the workspace (sign-in,
 * dashboard, /setup) must keep working before Drive is configured.
 * During `next build` they return placeholders so route collection
 * succeeds without live credentials.
 */
export function requireGoogleClientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (isMissing(v)) {
    if (isBuildPhase()) return "build-phase-placeholder-google-client-id";
    throw new Error(
      `GOOGLE_CLIENT_ID is not set. ${VERCEL_HINT}`
    );
  }
  return v as string;
}

export function requireGoogleClientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (isMissing(v)) {
    if (isBuildPhase()) return "build-phase-placeholder-google-client-secret";
    throw new Error(
      `GOOGLE_CLIENT_SECRET is not set. ${VERCEL_HINT}`
    );
  }
  return v as string;
}

export function requireGoogleDriveRefreshToken(): string {
  const v = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (isMissing(v)) {
    if (isBuildPhase()) return "build-phase-placeholder-google-refresh-token";
    throw new Error(
      `GOOGLE_DRIVE_REFRESH_TOKEN is not set. ${VERCEL_HINT} Complete the one-time setup at Admin → Drive setup first.`
    );
  }
  return v as string;
}

/** Validate all three Drive variables at once. Throws the first missing. */
export function assertDriveEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = requireGoogleClientId();
  const clientSecret = requireGoogleClientSecret();
  const refreshToken = requireGoogleDriveRefreshToken();
  return { clientId, clientSecret, refreshToken };
}
