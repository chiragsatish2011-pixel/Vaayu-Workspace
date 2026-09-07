import { NextResponse } from "next/server";
import { julesFetch } from "@/lib/jules";
import { requireApiSession } from "@/lib/session";

export async function GET() {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await julesFetch("sources");
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error || "Failed to fetch sources from Jules API" },
      { status: res.status }
    );
  }

  return NextResponse.json({
    sources: res.data?.sources || [],
    nextPageToken: res.data?.nextPageToken || null,
  });
}
