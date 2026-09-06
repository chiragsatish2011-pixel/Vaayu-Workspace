import { withAuth } from "next-auth/middleware";
import type { NextRequest } from "next/server";

/**
 * Protect every route except sign-in / sign-up / setup
 * (and NextAuth + setup APIs + static assets).
 * Unauthenticated visitors are redirected to /signin.
 *
 * Runs on the Edge as a short-lived check (reads the JWT, no DB call) —
 * fully compatible with Vercel serverless.
 *
 * Fail-fast: for protected routes, a missing NEXTAUTH_SECRET / NEXTAUTH_URL
 * throws a loud, named error instead of a generic 500. Public paths
 * (/signin, /setup, /api/auth/*, /api/setup/*) intentionally skip the
 * check so the first-run wizard works before env is set. Build phase
 * (`NEXT_PHASE`) also skips, so `next build` succeeds without live env.
 */

const protectedAuth = withAuth({
  pages: { signIn: "/signin" },
});

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname.startsWith("/signin/") ||
    pathname === "/setup" ||
    pathname.startsWith("/setup/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/setup")
  );
}

export default function middleware(req: NextRequest, ...rest: unknown[]) {
  // Let Next.js internals / static assets through (matcher already excludes
  // most, but keep this cheap guard for clarity).
  if (isPublicPath(req.nextUrl.pathname)) {
    // Still run the underlying auth middleware so its matcher semantics
    // stay single-sourced — it no-ops on public paths via `config.matcher`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (protectedAuth as any)(req, ...rest);
  }
  if (!isBuildPhase()) {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret || secret.trim().length === 0) {
      throw new Error(
        "NEXTAUTH_SECRET is not set. Add it in Vercel's Environment Variables settings for this environment."
      );
    }
    const url = process.env.NEXTAUTH_URL;
    if (!url || url.trim().length === 0) {
      throw new Error(
        "NEXTAUTH_URL is not set. Add it in Vercel's Environment Variables settings for this environment."
      );
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (protectedAuth as any)(req, ...rest);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /signin, /setup (public pages)
     * - /api/auth/* (NextAuth handler)
     * - /api/setup/* (first-run wizard APIs)
     * - Next.js internals and static files
     *
     * NOTE: there is intentionally no public /signup — accounts are created
     * by admins (/admin) or once via the setup wizard (/setup).
     */
    "/((?!api/auth|api/setup|setup|signin|_next/static|_next/image|favicon.ico|.*\\..*|public).*)",
  ],
};
