import { NextResponse } from "next/server";
import { julesFetch } from "@/lib/jules";
import { requireApiAdmin } from "@/lib/session";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireApiAdmin();
  if (!adminUser) {
    return NextResponse.json(
      { error: "Forbidden: Admin role required to archive sessions" },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  const sessionName = id.startsWith("sessions/") ? id : `sessions/${id}`;

  const res = await julesFetch(`${sessionName}:archive`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error || "Failed to archive session" },
      { status: res.status }
    );
  }

  return NextResponse.json({ result: res.data });
}
