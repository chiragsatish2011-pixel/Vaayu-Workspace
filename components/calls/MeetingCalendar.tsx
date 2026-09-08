"use client";

import { useMemo, useState } from "react";

type Occurrence = {
  meeting: { id: string; title: string; callType: "voice" | "video"; rrule: string | null };
  occurrenceStart: string;
};

export function MeetingCalendar({ occurrences, onSelectDate }: { occurrences: Occurrence[]; onSelectDate?: (d: Date) => void }) {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occ of occurrences) {
      const d = new Date(occ.occurrenceStart);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(occ);
    }
    return map;
  }, [occurrences]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold">{monthName}</h3>
        <div className="flex gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="grid h-7 w-7 place-items-center rounded-full border border-hairline hover:bg-fog">
            ‹
          </button>
          <button onClick={() => setCursor(new Date())} className="rounded-full border border-hairline px-3 py-1 text-xs">
            Today
          </button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="grid h-7 w-7 place-items-center rounded-full border border-hairline hover:bg-fog">
            ›
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-px rounded-xl bg-hairline-soft p-px">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-fog py-1 text-center font-mono text-[11px] uppercase tracking-wider text-stone">
            {d}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} className="h-24 bg-canvas" />;
          const key = `${year}-${month}-${day}`;
          const events = byDate.get(key) || [];
          const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
          return (
            <div
              key={idx}
              onClick={() => onSelectDate?.(new Date(year, month, day))}
              className={`h-24 cursor-pointer overflow-hidden bg-canvas p-1.5 hover:bg-fog ${isToday ? "ring-1 ring-ink ring-inset" : ""}`}
            >
              <div className={`text-xs font-semibold ${isToday ? "text-ink" : "text-steel"}`}>{day}</div>
              <div className="mt-1 space-y-0.5">
                {events.slice(0, 3).map((occ) => (
                  <div key={`${occ.meeting.id}-${occ.occurrenceStart}`} className={`truncate rounded px-1 py-0.5 text-[11px] leading-none ${occ.meeting.rrule ? "bg-violet/10 text-violet" : "bg-ink text-white"}`}>
                    {occ.meeting.title.slice(0, 18)}
                    {occ.meeting.rrule && " ↻"}
                  </div>
                ))}
                {events.length > 3 && <div className="text-[10px] text-stone">+{events.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
