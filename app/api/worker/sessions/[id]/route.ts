import { NextResponse } from "next/server";
import { julesFetch } from "@/lib/jules";
import { requireApiAdmin, requireApiSession } from "@/lib/session";

export async function GET(
  _req: Request,
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

  const [sessionRes, activitiesRes] = await Promise.all([
    julesFetch(sessionName),
    julesFetch(`${sessionName}/activities`),
  ]);

  if (!sessionRes.ok) {
    return NextResponse.json(
      { error: sessionRes.error || "Failed to fetch session" },
      { status: sessionRes.status }
    );
  }

  const activities = activitiesRes.ok ? activitiesRes.data?.activities || [] : [];

  return NextResponse.json({
    session: sessionRes.data,
    activities,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireApiAdmin();
  if (!adminUser) {
    return NextResponse.json(
      { error: "Forbidden: Admin role required to delete sessions" },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  const sessionName = id.startsWith("sessions/") ? id : `sessions/${id}`;

  const res = await julesFetch(sessionName, {
    method: "DELETE",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error || "Failed to delete session in Jules API" },
      { status: res.status }
    );
  }

  return NextResponse.json({ success: true, id });
}
