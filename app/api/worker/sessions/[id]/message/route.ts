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

  try {
    const body = await req.json();
    const prompt = body.prompt || body.message;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Message prompt is required" },
        { status: 400 }
      );
    }

    const sessionName = id.startsWith("sessions/") ? id : `sessions/${id}`;

    const res = await julesFetch(`${sessionName}:sendMessage`, {
      method: "POST",
      body: JSON.stringify({ prompt: prompt.trim() }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: res.error || "Failed to send message to Jules agent" },
        { status: res.status }
      );
    }

    return NextResponse.json({ result: res.data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Invalid request body" },
      { status: 400 }
    );
  }
}
