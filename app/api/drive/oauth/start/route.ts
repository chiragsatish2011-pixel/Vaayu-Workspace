import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_SCOPES } from "@/lib/drive";
import { requireGoogleClientId, requireGoogleClientSecret } from "@/lib/env";
import { requireApiAdmin } from "@/lib/session";

export const runtime = "nodejs";

const STATE_COOKIE = "drive_oauth_state";

/**
 * GET /api/drive/oauth/start — admin-only entry to the one-time Drive
 * authorization. Builds Google's OAuth consent URL (offline access so a
 * refresh token is issued, prompt=consent so re-running re-issues one,
 * random state against CSRF) and redirects the owner's browser there.
 * Only the client ID travels in the URL — the secret never leaves the
 * server (it is used in the callback exchange).
 */
export async function GET(req: NextRequest) {
  const admin = await requireApiAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 }
    );
  }

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = requireGoogleClientId();
    clientSecret = requireGoogleClientSecret();
    void clientSecret; // needed only at the callback exchange, not here
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }

  const redirectUri = `${new URL(req.url).origin}/api/drive/oauth/callback`;
  const state = randomBytes(32).toString("hex");
  const consentUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      // Drive backend scope + Sheets scope (Checkpoints store) — one consent,
      // one refresh token for both. Re-running re-issues a token with both.
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();

  console.log(`[drive/oauth] consent started by admin (${admin.email})`);
  const res = NextResponse.redirect(consentUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/drive/oauth/callback",
    maxAge: 600,
  });
  return res;
}
