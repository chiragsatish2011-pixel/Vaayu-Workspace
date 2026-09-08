"use client";

import { isJoinable, type ScheduledMeetingRow } from "@/lib/scheduler";

type MeetingRow = ScheduledMeetingRow;

type Occurrence = {
  meeting: MeetingRow;
  occurrenceStart: string;
  occurrenceEnd: string;
  isRecurring: boolean;
};

export function MeetingList({
  occurrences,
  currentUserId,
  currentUserRole,
  onJoin,
  onEdit,
  onCancel,
}: {
  occurrences: Occurrence[];
  currentUserId: string | null;
  currentUserRole: "admin" | "member";
  onJoin: (m: MeetingRow, occStart: string) => void;
  onEdit: (m: MeetingRow) => void;
  onCancel: (m: MeetingRow, occStart: string | null, mode: "single" | "series") => void;
}) {
  const canManage = (m: MeetingRow) => m.organizerId === currentUserId || currentUserRole === "admin";

  // Group by date string
  const grouped = occurrences.reduce<Record<string, Occurrence[]>>((acc, occ) => {
    const d = new Date(occ.occurrenceStart).toDateString();
    if (!acc[d]) acc[d] = [];
    acc[d].push(occ);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  if (occurrences.length === 0) {
    return <p className="py-8 text-center text-sm text-steel">No upcoming meetings. Schedule one above.</p>;
  }

  return (
    <div className="space-y-6">
      {dates.map((dateStr) => (
        <div key={dateStr}>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">{new Date(dateStr).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <div className="mt-2 space-y-2">
            {grouped[dateStr]!.map((occ) => {
              const start = new Date(occ.occurrenceStart);
              const joinable = isJoinable(start, occ.meeting.durationMinutes);
              const isManage = canManage(occ.meeting);
              return (
                <div key={`${occ.meeting.id}-${occ.occurrenceStart}`} className="flex items-center gap-3 rounded-xl border border-hairline bg-canvas p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{occ.meeting.title}</p>
                      {occ.isRecurring && <span className="rounded-full bg-violet/10 px-2 py-0.5 font-mono text-[10px] text-violet">↻ recurring</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${occ.meeting.callType === "video" ? "bg-teal/10 text-teal" : "bg-ink text-white"}`}>{occ.meeting.callType}</span>
                    </div>
                    <p className="font-mono text-xs text-steel">
                      {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {occ.meeting.durationMinutes} min · {occ.meeting.projectId ? `Project ${occ.meeting.projectId.slice(0, 6)}` : "No project"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onJoin(occ.meeting, occ.occurrenceStart)}
                      disabled={!joinable}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold ${joinable ? "bg-ink text-white hover:bg-charcoal" : "bg-fog text-steel cursor-not-allowed"}`}
                      title={joinable ? "Join now (available 10 min early)" : `Join available 10 min before ${start.toLocaleTimeString()}`}
                    >
                      {joinable ? "Join" : "Not yet"}
                    </button>
                    {isManage && (
                      <>
                        <button onClick={() => onEdit(occ.meeting)} className="rounded-full border border-hairline px-3 py-1.5 text-xs hover:border-ink">
                          Edit
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => {
                              if (occ.isRecurring) {
                                // Teams-style: single occurrence vs entire series. One dialog picks scope.
                                const isSingle = window.confirm(
                                  "Recurring meeting — OK = cancel THIS occurrence only, Cancel = cancel the ENTIRE series."
                                );
                                if (isSingle) {
                                  if (window.confirm("Cancel just this occurrence?")) onCancel(occ.meeting, occ.occurrenceStart, "single");
                                } else if (window.confirm("Cancel entire series? This deletes all future occurrences.")) {
                                  onCancel(occ.meeting, null, "series");
                                }
                              } else {
                                if (window.confirm("Cancel this meeting?")) onCancel(occ.meeting, null, "series");
                              }
                            }}
                            className="rounded-full border border-hairline px-3 py-1.5 text-xs text-steel hover:border-error hover:text-error"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
