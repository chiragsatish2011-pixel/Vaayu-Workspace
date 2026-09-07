import { NextResponse } from "next/server";
import { calculateSessionStats, julesFetch } from "@/lib/jules";
import { requireApiSession } from "@/lib/session";

export async function GET() {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch sessions from Jules API
  const res = await julesFetch("sessions");
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error || "Failed to fetch sessions from Jules API" },
      { status: res.status }
    );
  }

  const rawSessions = res.data?.sessions || [];
  const stats = calculateSessionStats(rawSessions);

  return NextResponse.json({
    sessions: rawSessions,
    nextPageToken: res.data?.nextPageToken || null,
    stats,
  });
}

export async function POST(req: Request) {
  const user = await requireApiSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, title, sourceContext, requirePlanApproval, automationMode } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "Prompt is required to create a session" },
        { status: 400 }
      );
    }

    // Check active concurrent session quota before creating
    const listRes = await julesFetch("sessions");
    if (listRes.ok) {
      const stats = calculateSessionStats(listRes.data?.sessions || []);
      if (stats.activeConcurrent >= stats.maxConcurrentLimit) {
        return NextResponse.json(
          {
            error: `Concurrent session limit reached (${stats.activeConcurrent}/${stats.maxConcurrentLimit}). Please complete or archive active sessions first.`,
          },
          { status: 429 }
        );
      }
      if (stats.used24h >= stats.total24hLimit) {
        return NextResponse.json(
          {
            error: `24-hour session limit reached (${stats.used24h}/${stats.total24hLimit}). Please wait for quota reset.`,
          },
          { status: 429 }
        );
      }
    }

    const payload: Record<string, any> = {
      prompt: prompt.trim(),
    };

    if (title && typeof title === "string" && title.trim()) {
      payload.title = title.trim();
    }

    if (sourceContext && typeof sourceContext === "object") {
      payload.sourceContext = sourceContext;
    }

    if (typeof requirePlanApproval === "boolean") {
      payload.requirePlanApproval = requirePlanApproval;
    }

    if (automationMode) {
      payload.automationMode = automationMode;
    }

    const res = await julesFetch("sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: res.error || "Failed to create session in Jules API" },
        { status: res.status }
      );
    }

    return NextResponse.json({ session: res.data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Invalid request body" },
      { status: 400 }
    );
  }
}
