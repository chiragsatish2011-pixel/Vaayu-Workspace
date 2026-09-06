import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireGoogleClientId, requireGoogleClientSecret } from "@/lib/env";
import { requireApiAdmin } from "@/lib/session";

export const runtime = "nodejs";

const STATE_COOKIE = "drive_oauth_state";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(title)}</title>` +
      `<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f7f8fa;color:#0a0a0a;display:flex;justify-content:center;padding:48px 16px;margin:0}` +
      `.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;max-width:640px;width:100%}` +
      `h1{font-size:22px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#333}` +
      `code{display:block;background:#0a0a0a;color:#fff;border-radius:8px;padding:14px 16px;font-size:13px;word-break:break-all;margin:12px 0}` +
      `.warn{background:#fdeeee;border:1px solid #d45656;color:#a33;border-radius:8px;padding:10px 14px;font-size:13px}` +
      `a{color:#1d4ed8}button{background:#0a0a0a;color:#fff;border:0;border-radius:999px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer}</style></head>` +
      `<body><div class="card">${body}</div>` +
      `<script>function copyToken(){var t=document.getElementById('rt').innerText;navigator.clipboard.writeText(t).then(function(){var b=document.getElementById('cp');b.innerText='Copied';setTimeout(function(){b.innerText='Copy'},2000);});}</script>` +
      `</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/**
 * GET /api/drive/oauth/callback — Google redirects the owner here after
 * consent. Admin session + state cookie required (CSRF protection), then
 * the code is exchanged server-side for tokens. The refresh token is
 * shown ONCE on screen for the owner to save as GOOGLE_DRIVE_REFRESH_TOKEN
 * in Vercel's dashboard — never stored in the database, never logged.
 */
export async function GET(req: NextRequest) {
  const admin = await requireApiAdmin();
  if (!admin) {
    return page(
      "Drive setup — denied",
      `<h1>Admin access required.</h1><p>Sign in as an admin, then restart from <a href="/admin/drive-setup">Admin → Drive setup</a>.</p>`
    );
  }

  const params = new URL(req.url).searchParams;
  const googleError = params.get("error");
  if (googleError) {
    console.error(`[drive/oauth] consent error for (${admin.email}): ${googleError}`);
    return page(
      "Drive setup — consent failed",
      `<h1>Google consent failed.</h1><p>Google returned: <strong>${escapeHtml(googleError)}</strong>. Go back to <a href="/admin/drive-setup">Drive setup</a> and try again.</p>`
    );
  }

  const state = params.get("state") ?? "";
  const cookieState = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const stateOk =
    state.length > 0 &&
    cookieState.length === state.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(cookieState));
  if (!stateOk) {
    console.error(`[drive/oauth] state mismatch for (${admin.email})`);
    return page(
      "Drive setup — invalid state",
      `<h1>Invalid OAuth state.</h1><p>Possible expired or forged request. Start again from <a href="/admin/drive-setup">Drive setup</a>.</p>`
    );
  }

  const code = params.get("code") ?? "";
  if (!code) {
    return page(
      "Drive setup — missing code",
      `<h1>No authorization code received.</h1><p>Start again from <a href="/admin/drive-setup">Drive setup</a>.</p>`
    );
  }

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = requireGoogleClientId();
    clientSecret = requireGoogleClientSecret();
  } catch (err) {
    return page(
      "Drive setup — not configured",
      `<h1>Google credentials missing.</h1><p>${escapeHtml((err as Error).message)}</p>`
    );
  }

  const redirectUri = `${new URL(req.url).origin}/api/drive/oauth/callback`;
  interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }
  let tokens: TokenResponse | null = null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    tokens = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!res.ok) throw new Error("token exchange failed");
  } catch (err) {
    console.error("[drive/oauth] token exchange failed", err);
    return page(
      "Drive setup — exchange failed",
      `<h1>Could not exchange the code.</h1><p>Check that the redirect URI below is registered in Google Cloud → Credentials → your OAuth client, then try again. Expected redirect URI:<br><code>${escapeHtml(redirectUri)}</code></p>`
    );
  }

  if (typeof tokens?.refresh_token !== "string" || !tokens.refresh_token) {
    console.error(`[drive/oauth] no refresh token issued for (${admin.email})`);
    return page(
      "Drive setup — no refresh token",
      `<h1>No refresh token was issued.</h1><p>Google only returns one with offline access + a fresh consent. Revoke the app at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, then run setup again (it always uses <strong>prompt=consent</strong>).</p>`
    );
  }

  console.log(`[drive/oauth] refresh token issued for admin (${admin.email})`);
  const out = page(
    "Drive setup — save this token",
    `<h1>Copy this now — it won't be shown again.</h1>` +
      `<p>Save it as <strong>GOOGLE_DRIVE_REFRESH_TOKEN</strong> in Vercel → Project → Settings → Environment Variables (all environments), then redeploy.</p>` +
      `<code id="rt">${escapeHtml(tokens.refresh_token)}</code>` +
      `<p><button id="cp" onclick="copyToken()">Copy</button></p>` +
      `<p class="warn">Anyone with this token can access the Drive folder. Never commit it, never share it.</p>`
  );
  out.cookies.delete(STATE_COOKIE);
  return out;
}
