import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISABLED_MSG =
  "Calls are temporarily unavailable across the workspace. Our calling provider needs billing enabled before rooms can start — please try again later.";

function disabled() {
  return NextResponse.json({ error: DISABLED_MSG, code: "calls-disabled" }, { status: 503 });
}

export async function GET() {
  return disabled();
}
export async function POST() {
  return disabled();
}
export async function DELETE() {
  return disabled();
}
