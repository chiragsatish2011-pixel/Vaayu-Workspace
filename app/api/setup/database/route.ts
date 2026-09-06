import { NextResponse } from "next/server";
import { isProduction, saveDevEnv, testDatabaseUrl } from "@/lib/setup";

/**
 * POST /api/setup/database { databaseUrl } — test a pasted Postgres URL and,
 * in local dev, persist it to `.env.local`. In production the URL is tested
 * (harmless SELECT 1) but never saved — env belongs in Vercel's dashboard.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { databaseUrl: raw } = body as { databaseUrl?: unknown };
  const databaseUrl = typeof raw === "string" ? raw.trim() : "";

  if (!/^postgresql:\/\/.+/.test(databaseUrl)) {
    return NextResponse.json(
      { error: "That doesn't look like a Postgres URL. It should start with postgresql://." },
      { status: 400 }
    );
  }

  let reachable = false;
  try {
    reachable = await testDatabaseUrl(databaseUrl);
  } catch (err) {
    console.error("[setup/database] test failed", err);
  }
  if (!reachable) {
    return NextResponse.json(
      { error: "Couldn't connect with that URL. Check it and try again." },
      { status: 422 }
    );
  }

  if (isProduction()) {
    return NextResponse.json({
      reachable: true,
      saved: false,
      message:
        "Connection works. Now set DATABASE_URL to this value in Vercel → Project Settings → Environment Variables, redeploy, and continue setup.",
    });
  }

  try {
    await saveDevEnv({ DATABASE_URL: databaseUrl });
  } catch (err) {
    console.error("[setup/database] save failed", err);
    return NextResponse.json(
      { error: "Connected, but couldn't save. Add DATABASE_URL to .env.local manually." },
      { status: 500 }
    );
  }
  return NextResponse.json({ reachable: true, saved: true });
}
