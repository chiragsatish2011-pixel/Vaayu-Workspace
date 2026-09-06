import { NextResponse } from "next/server";
import { runBootstrap, testDatabaseUrl } from "@/lib/setup";

/**
 * POST /api/setup/migrate — create the tables on the configured database.
 * Idempotent: refuses when tables already exist, so it can never wipe data.
 */
export async function POST() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { error: "No database configured yet. Complete step 1 first." },
      { status: 503 }
    );
  }
  try {
    if (!(await testDatabaseUrl(url))) {
      return NextResponse.json(
        { error: "Can't reach the database. Check DATABASE_URL and try again." },
        { status: 503 }
      );
    }
    const result = await runBootstrap(url);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[setup/migrate]", err);
    return NextResponse.json(
      { error: "Couldn't create the tables. Check the database URL and permissions." },
      { status: 500 }
    );
  }
}
