import { RRule } from "rrule";

export interface ScheduledMeetingRow {
  id: string;
  title: string;
  organizerId: string;
  startTime: string;
  durationMinutes: number;
  callType: "voice" | "video";
  rrule: string | null;
  inviteeIds: string;
  projectId: string | null;
  excludedDates: string;
  createdAt: string;
}

export interface Occurrence {
  meeting: ScheduledMeetingRow;
  start: Date;
  end: Date;
  isRecurring: boolean;
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  } catch {}
  return [];
}

export function expandMeetings(rows: ScheduledMeetingRow[], horizonDays = 90): Occurrence[] {
  const out: Occurrence[] = [];
  const horizon = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000);
  for (const m of rows) {
    const start = new Date(m.startTime);
    const duration = m.durationMinutes;
    if (!m.rrule) {
      out.push({ meeting: m, start, end: new Date(start.getTime() + duration * 60000), isRecurring: false });
      continue;
    }
    try {
      const rule = RRule.fromString(m.rrule);
      const withStart = new RRule({ ...rule.origOptions, dtstart: start });
      const dates = withStart.between(start, horizon, true);
      const excluded = new Set(parseJsonArray(m.excludedDates).map((d) => new Date(d).toISOString()));
      for (const d of dates) {
        if (excluded.has(d.toISOString())) continue;
        out.push({ meeting: m, start: d, end: new Date(d.getTime() + duration * 60000), isRecurring: true });
      }
    } catch {
      out.push({ meeting: m, start, end: new Date(start.getTime() + duration * 60000), isRecurring: true });
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

export function isJoinable(occurrenceStart: Date, durationMinutes: number, now = new Date()): boolean {
  const start = occurrenceStart.getTime();
  const end = start + durationMinutes * 60000;
  const early = start - 10 * 60 * 1000; // 10 min early, per Teams
  const t = now.getTime();
  return t >= early && t <= end;
}

export function formatTime(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
