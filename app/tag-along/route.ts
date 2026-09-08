import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serve the Tag Along HTML verbatim — zero modifications.
 * This route exists so /tag-along is:
 *  1. Public (bypass middleware auth — see middleware.ts)
 *  2. Deployed on Vercel as a first-class Next.js route (no build quirks from static-only deploys)
 *  3. 100% identical to the original file (read directly from public/tag-along.html)
 *
 * The file at public/tag-along.html is the single source of truth.
 * public/tag-along/index.html exists for clean-url static fallback (/tag-along/index.html).
 * This handler just streams that same file at /tag-along.
 */
export const dynamic = "force-static";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "tag-along.html");
  const html = await readFile(filePath, "utf-8");

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Cache on Vercel edge, but allow instant purge on redeploy
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
