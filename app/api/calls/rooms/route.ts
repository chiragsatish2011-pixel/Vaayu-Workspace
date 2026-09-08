import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISABLED_MSG =
  "Calls are temporarily disabled. Daily.co now requires a payment method on file (account-missing-payment-method) and the workspace has paused Calls across the app. You can safely remove DAILY_API_KEY from Vercel. Re-enable by wiring a free provider (e.g. Jitsi) or restoring Daily billing.";

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
