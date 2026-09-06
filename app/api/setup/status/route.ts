import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/setup";

/** GET /api/setup/status — booleans only, safe to expose pre-auth. */
export async function GET() {
  try {
    return NextResponse.json(await getSetupStatus());
  } catch (err) {
    console.error("[setup/status]", err);
    return NextResponse.json(
      {
        configured: false,
        reachable: false,
        tables: false,
        admin: false,
        isProduction: process.env.NODE_ENV === "production",
      },
      { status: 500 }
    );
  }
}
