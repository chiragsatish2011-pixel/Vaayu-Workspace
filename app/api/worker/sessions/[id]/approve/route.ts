import { NextResponse } from "next/server";
import { julesFetch } from "@/lib/jules";
import { requireApiSession } from "@/lib/session";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  const sessionName = id.startsWith("sessions/") ? id : `sessions/${id}`;

  let body = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // optional body
  }

  const res = await julesFetch(`${sessionName}:approvePlan`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error || "Failed to approve plan" },
      { status: res.status }
    );
  }

  return NextResponse.json({ result: res.data });
}
