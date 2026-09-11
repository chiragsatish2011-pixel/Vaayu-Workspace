import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISABLED_MSG =
  "Scheduling is paused while Calls is unavailable. It will return automatically once calls are re-enabled — please try again later.";

function disabled() {
  return NextResponse.json({ error: DISABLED_MSG, code: "calls-disabled" }, { status: 503 });
}

export async function GET() {
  return disabled();
}
export async function POST() {
  return disabled();
}
export async function PATCH() {
  return disabled();
}
export async function DELETE() {
  return disabled();
}
