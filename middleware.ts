import { withAuth } from "next-auth/middleware";

/**
 * Protect every route except sign-in / sign-up / setup
 * (and NextAuth + setup APIs + static assets).
 * Unauthenticated visitors are redirected to /signin.
 *
 * Runs on the Edge as a short-lived check (reads the JWT, no DB call) —
 * fully compatible with Vercel serverless.
 */
export default withAuth({
  pages: { signIn: "/signin" },
});

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
