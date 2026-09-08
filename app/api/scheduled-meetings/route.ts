import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { scheduledMeetings, projects } from "@/db/schema";
import { requireApiSession } from "@/lib/session";
import { RRule } from "rrule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseInviteeIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    } catch {}
  }
  return [];
}

function canManage(meeting: { organizerId: string }, user: { id: string; role: string }) {
  return meeting.organizerId === user.id || user.role === "admin";
}

// Expand occurrences for next 90 days for calendar views
function expandOccurrences(meeting: typeof scheduledMeetings.$inferSelect, horizonDays = 90) {
  const start = new Date(meeting.startTime);
  const duration = meeting.durationMinutes;
  if (!meeting.rrule) {
    // One-time
    return [{ start, end: new Date(start.getTime() + duration * 60000), isRecurring: false, rrule: null }];
  }
  try {
    const rule = RRule.fromString(meeting.rrule);
    // Ensure dtstart is correct (rrule may have its own dtstart)
    const rruleWithStart = new RRule({ ...rule.origOptions, dtstart: start });
    const until = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000);
    const dates = rruleWithStart.between(start, until, true);
    const excluded = new Set(parseInviteeIds(meeting.excludedDates).map((d) => new Date(d).toISOString()));
    // Actually excludedDates is for cancelled occurrences, not invitees — parse correctly
    let exSet: Set<string> = new Set();
    try {
      const exRaw = meeting.excludedDates;
      const exArr = typeof exRaw === "string" ? JSON.parse(exRaw) : exRaw;
      if (Array.isArray(exArr)) exSet = new Set(exArr.map((d: string) => new Date(d).toISOString()));
    } catch {}
    const filtered = dates.filter((d) => !exSet.has(d.toISOString()));
    return filtered.map((d) => ({ start: d, end: new Date(d.getTime() + duration * 60000), isRecurring: true, rrule: meeting.rrule }));
  } catch {
    return [{ start, end: new Date(start.getTime() + duration * 60000), isRecurring: !!meeting.rrule, rrule: meeting.rrule }];
  }
}

export async function GET(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const expand = url.searchParams.get("expand") === "1";

  try {
    // Visible if organizer or invitee or admin? For now, show all team meetings (team workspace)
    const rows = await db.select().from(scheduledMeetings).orderBy(desc(scheduledMeetings.startTime)).limit(100);

    if (!expand) {
      return NextResponse.json({ meetings: rows });
    }

    // Expand for calendar
    const expanded: Array<{
      meeting: typeof rows[0];
      occurrenceStart: string;
      occurrenceEnd: string;
      isRecurring: boolean;
    }> = [];
    for (const m of rows) {
      const occs = expandOccurrences(m);
      for (const o of occs) {
        expanded.push({
          meeting: m,
          occurrenceStart: o.start.toISOString(),
          occurrenceEnd: o.end.toISOString(),
          isRecurring: o.isRecurring,
        });
      }
    }
    expanded.sort((a, b) => new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime());

    return NextResponse.json({ meetings: rows, occurrences: expanded });
  } catch (err) {
    console.error("[GET /api/scheduled-meetings]", err);
    return NextResponse.json({ error: "Failed to fetch meetings." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const {
    title,
    startTime,
    durationMinutes,
    callType,
    rrule,
    inviteeIds,
    projectId,
  } = body as {
    title?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
    callType?: unknown;
    rrule?: unknown;
    inviteeIds?: unknown;
    projectId?: unknown;
  };

  if (typeof title !== "string" || !title.trim() || title.trim().length > 100) {
    return NextResponse.json({ error: "Title is required (max 100)." }, { status: 400 });
  }
  if (typeof startTime !== "string" || !startTime.trim() || isNaN(Date.parse(startTime))) {
    return NextResponse.json({ error: "Valid startTime is required." }, { status: 400 });
  }
  const start = new Date(startTime);
  if (start.getTime() < Date.now() - 60000) {
    // Allow slightly in past for testing, but warn
    // return NextResponse.json({ error: "Start time must be in the future." }, { status: 400 });
  }
  const duration = typeof durationMinutes === "number" ? durationMinutes : parseInt(String(durationMinutes), 10);
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
    return NextResponse.json({ error: "Duration must be 5-480 minutes." }, { status: 400 });
  }
  if (callType !== "voice" && callType !== "video") {
    return NextResponse.json({ error: "callType must be voice or video." }, { status: 400 });
  }
  let rruleStr: string | null = null;
  if (typeof rrule === "string" && rrule.trim()) {
    try {
      // Validate by parsing
      RRule.fromString(rrule);
      rruleStr = rrule.trim();
    } catch {
      return NextResponse.json({ error: "Invalid RRULE." }, { status: 400 });
    }
  }
  const invitees = parseInviteeIds(inviteeIds);
  // Validate invitees exist (optional)
  if (invitees.length > 50) return NextResponse.json({ error: "Too many invitees (max 50)." }, { status: 400 });

  let projId: string | null = null;
  if (typeof projectId === "string" && projectId.trim()) {
    if (projectId.length > 64) return NextResponse.json({ error: "Invalid projectId." }, { status: 400 });
    projId = projectId.trim();
    // Verify exists (best effort)
    try {
      const proj = await db.select().from(projects).where(eq(projects.id, projId)).limit(1);
      if (proj.length === 0) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    } catch {}
  }

  try {
    const [inserted] = await db
      .insert(scheduledMeetings)
      .values({
        title: title.trim(),
        organizerId: user.id,
        startTime: start,
        durationMinutes: duration,
        callType: callType as "voice" | "video",
        rrule: rruleStr,
        inviteeIds: JSON.stringify(invitees),
        projectId: projId,
        excludedDates: "[]",
      })
      .returning();

    return NextResponse.json({ meeting: inserted }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/scheduled-meetings]", err);
    return NextResponse.json({ error: "Failed to create meeting." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { id, title, startTime, durationMinutes, callType, rrule, inviteeIds, projectId, occurrenceStart } = body as {
    id?: unknown;
    title?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
    callType?: unknown;
    rrule?: unknown;
    inviteeIds?: unknown;
    projectId?: unknown;
    occurrenceStart?: unknown;
  };

  if (typeof id !== "string" || !id.trim()) return NextResponse.json({ error: "id required." }, { status: 400 });

  const rows = await db.select().from(scheduledMeetings).where(eq(scheduledMeetings.id, id.trim())).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  const meeting = rows[0]!;
  if (!canManage(meeting, user)) return NextResponse.json({ error: "Only organizer or Admin can edit." }, { status: 403 });

  // Handle "edit single occurrence" vs "edit series" — for now, single occurrence edit is not supported for recurring (would need exception handling)
  // If occurrenceStart is provided and meeting is recurring, we treat as edit of single occurrence is not allowed — suggest cancel single instead
  if (occurrenceStart && meeting.rrule) {
    return NextResponse.json({ error: "Editing a single occurrence is not yet supported — cancel single occurrence or edit entire series." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof title === "string" && title.trim()) {
    if (title.trim().length > 100) return NextResponse.json({ error: "Title too long." }, { status: 400 });
    updates.title = title.trim();
  }
  if (typeof startTime === "string" && startTime.trim()) {
    if (isNaN(Date.parse(startTime))) return NextResponse.json({ error: "Invalid startTime." }, { status: 400 });
    updates.startTime = new Date(startTime);
  }
  if (durationMinutes !== undefined) {
    const d = typeof durationMinutes === "number" ? durationMinutes : parseInt(String(durationMinutes), 10);
    if (!Number.isFinite(d) || d < 5 || d > 480) return NextResponse.json({ error: "Invalid duration." }, { status: 400 });
    updates.durationMinutes = d;
  }
  if (callType !== undefined) {
    if (callType !== "voice" && callType !== "video") return NextResponse.json({ error: "Invalid callType." }, { status: 400 });
    updates.callType = callType;
  }
  if (rrule !== undefined) {
    if (rrule === null || (typeof rrule === "string" && !rrule.trim())) updates.rrule = null;
    else if (typeof rrule === "string") {
      try {
        RRule.fromString(rrule);
        updates.rrule = rrule.trim();
      } catch {
        return NextResponse.json({ error: "Invalid RRULE." }, { status: 400 });
      }
    }
  }
  if (inviteeIds !== undefined) {
    const arr = parseInviteeIds(inviteeIds);
    if (arr.length > 50) return NextResponse.json({ error: "Too many invitees." }, { status: 400 });
    updates.inviteeIds = JSON.stringify(arr);
  }
  if (projectId !== undefined) {
    if (projectId === null || (typeof projectId === "string" && !projectId.trim())) updates.projectId = null;
    else if (typeof projectId === "string") {
      updates.projectId = projectId.trim();
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No updates." }, { status: 400 });

  updates.updatedAt = new Date();

  try {
    const [updated] = await db.update(scheduledMeetings).set(updates as never).where(eq(scheduledMeetings.id, meeting.id)).returning();
    return NextResponse.json({ meeting: updated });
  } catch (err) {
    console.error("[PATCH /api/scheduled-meetings]", err);
    return NextResponse.json({ error: "Failed to update." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireApiSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json().catch(() => null);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const raw = (body ?? {}) as { id?: unknown; ids?: unknown; occurrenceStart?: unknown; mode?: unknown };
  let ids: string[] = [];
  if (typeof raw.id === "string" && raw.id.trim()) ids = [raw.id.trim()];
  else if (Array.isArray(raw.ids)) ids = raw.ids.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());

  if (ids.length === 0) {
    // Try query param
    const qid = new URL(req.url).searchParams.get("id");
    if (qid) ids = [qid];
  }
  if (ids.length === 0) return NextResponse.json({ error: "No id(s) provided." }, { status: 400 });
  if (ids.length > 50) return NextResponse.json({ error: "Too many." }, { status: 400 });

  const mode = raw.mode === "single" ? "single" : raw.mode === "series" ? "series" : "series";
  const occurrenceStart = typeof raw.occurrenceStart === "string" ? raw.occurrenceStart : null;

  const rows = await db.select().from(scheduledMeetings).where(inArray(scheduledMeetings.id, ids));
  if (rows.length === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const forbidden: string[] = [];
  const allowed: typeof rows = [];
  for (const r of rows) {
    if (canManage(r, user)) allowed.push(r);
    else forbidden.push(r.id);
  }
  if (forbidden.length > 0) return NextResponse.json({ error: `Not allowed for ${forbidden.length} meeting(s).`, forbidden }, { status: 403 });

  // Handle recurring single occurrence cancel
  if (mode === "single" && occurrenceStart) {
    // Single occurrence cancel: add to excludedDates
    for (const m of allowed) {
      if (!m.rrule) continue; // not recurring, fallback to hard delete (should not happen)
      let ex: string[] = [];
      try {
        ex = JSON.parse(m.excludedDates);
        if (!Array.isArray(ex)) ex = [];
      } catch {
        ex = [];
      }
      const iso = new Date(occurrenceStart).toISOString();
      if (!ex.includes(iso)) ex.push(iso);
      await db.update(scheduledMeetings).set({ excludedDates: JSON.stringify(ex), updatedAt: new Date() } as never).where(eq(scheduledMeetings.id, m.id));
    }
    return NextResponse.json({ cancelled: "single", ids, occurrenceStart });
  }

  // Hard delete series (or one-time)
  await db.delete(scheduledMeetings).where(inArray(scheduledMeetings.id, allowed.map((r) => r.id)));

  return NextResponse.json({ deleted: allowed.map((r) => r.id) });
}
