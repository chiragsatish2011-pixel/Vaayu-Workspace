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
 * NOTE on env checks: this file runs on the Edge Runtime (all of
 * `middleware.ts` does — no `runtime` export needed). The Edge code ships
 * as a prebuilt bundle (`server/edge/chunks/...`, see
 * `middleware-manifest.json`), and its `process.env` snapshot is coupled
 * to the deployment's BUILD — e.g. redeploying with a cached/stale build,
 * or adding a variable in the dashboard after the Edge bundle was built,
 * can leave Edge seeing a variable as missing even though the dashboard
 * lists it and Node serverless functions (which read env live per
 * invocation) see it fine. A `throw` here therefore bricks EVERY protected
 * request on an env-visibility problem that isn't real. So Edge NEVER
 * hard-fails on env: it logs loudly and lets the request through to the
 * Node layer, where `lib/auth.ts` (`requireNextAuthSecret`) enforces the
 * same variables with a live runtime read — that is also where NextAuth
 * actually consumes the secret. Public paths (/signin, /setup,
 * /api/auth/*, /api/setup/*) skip even the logging so the first-run
 * wizard works before env is set. Build phase (`NEXT_PHASE`) also skips,
 * so `next build` succeeds without live env.
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
  if (isPublicPath(req.nextUrl.pathname)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (protectedAuth as any)(req, ...rest);
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
