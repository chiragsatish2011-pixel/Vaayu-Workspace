import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISABLED_MSG =
  "Scheduling is disabled while Calls is paused (Daily.co payment-method wall). Remove DAILY_API_KEY safely; scheduling returns when Calls is re-enabled.";

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
