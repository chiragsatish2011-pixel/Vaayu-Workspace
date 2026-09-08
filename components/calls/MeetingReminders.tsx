"use client";

import { useEffect, useRef, useState } from "react";
import {
  getAppEnabled,
  getNotificationPermission,
  isNotificationSupported,
} from "@/lib/callNotifications";

const REMINDER_LEAD_MS = 10 * 60 * 1000; // 10 min default, per Teams
const SEEN_KEY = "vaayu:scheduled-reminders:seen";

function getSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function setSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-100)));
  } catch {}
}

type Toast = { kind: "invite" | "reminder"; title: string; body: string };

export function MeetingReminders({ userId }: { userId?: string | null }) {
  const seenRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    try {
      seenRef.current = getSeen();
    } catch {}
    const onReminder = (e: Event) => {
      const detail = (e as CustomEvent).detail as { meeting?: { title?: string }; occurrenceStart?: string } | undefined;
      if (detail?.meeting?.title) {
        setToast({
          kind: "reminder",
          title: `Starting soon: ${detail.meeting.title}`,
          body: detail.occurrenceStart ? new Date(detail.occurrenceStart).toLocaleString() : "",
        });
        window.setTimeout(() => setToast(null), 12000);
      }
    };
    window.addEventListener("vaayu:meeting-reminder", onReminder);
    return () => window.removeEventListener("vaayu:meeting-reminder", onReminder);
  }, []);

  useEffect(() => {
    if (!userId) return;

    const check = async () => {
      try {
        const res = await fetch("/api/scheduled-meetings?expand=1", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.occurrences) return;
        const now = Date.now();
        const occurrences: Array<{ meeting: { id: string; title: string; inviteeIds: string }; occurrenceStart: string }> = data.occurrences;
        const meetings: Array<{ id: string; organizerId: string; createdAt: string }> = Array.isArray(data.meetings) ? data.meetings : [];
        const byId = new Map(meetings.map((m) => [m.id, m]));

        for (const occ of occurrences) {
          let invitees: string[] = [];
          try {
            const parsed = JSON.parse(occ.meeting.inviteeIds);
            if (Array.isArray(parsed)) invitees = parsed.filter((x): x is string => typeof x === "string");
          } catch {}
          const organizerId = byId.get(occ.meeting.id)?.organizerId;
          const isTeamWide = invitees.length === 0;
          const isRelevant = isTeamWide || invitees.includes(userId) || organizerId === userId;
          if (!isRelevant) continue;

          const start = new Date(occ.occurrenceStart).getTime();
          if (!Number.isFinite(start)) continue;
          const diff = start - now;

          // Respect the per-user Settings toggle + browser permission for BROWSER notifications.
          // In-app toast/badge still shows regardless (separated per earlier notification work).
          const browserAllowed =
            isNotificationSupported() && getNotificationPermission() === "granted" && getAppEnabled(userId);

          // "You've been invited" — fires once when a meeting row is newly created (<10 min old) and start is future.
          const createdAt = byId.get(occ.meeting.id)?.createdAt;
          if (createdAt && !occ.meeting.id.includes("x")) {
            const createdDiff = now - new Date(createdAt).getTime();
            if (createdDiff >= 0 && createdDiff < 10 * 60 * 1000 && diff > 0) {
              const key = `invite-${occ.meeting.id}-${occ.occurrenceStart}`;
              if (!seenRef.current.has(key)) {
                seenRef.current.add(key);
                setSeen(Array.from(seenRef.current));
                setToast({ kind: "invite", title: `You've been invited: ${occ.meeting.title}`, body: `On ${new Date(occ.occurrenceStart).toLocaleString()}` });
                window.setTimeout(() => setToast(null), 12000);
                if (browserAllowed) {
                  try {
                    new Notification(`You've been invited: ${occ.meeting.title}`, {
                      body: `On ${new Date(occ.occurrenceStart).toLocaleString()}`,
                      icon: "/icon.png",
                      tag: `vaayu-invite-${occ.meeting.id}`,
                    });
                  } catch {}
                }
              }
            }
          }

          // Reminder — fires once per occurrence any time within the 10-min lead window
          // (not just the first 60s, so a reopened tab still reminds). Seen-set dedups.
          if (diff > 0 && diff <= REMINDER_LEAD_MS) {
            const key = `reminder-${occ.meeting.id}-${occ.occurrenceStart}`;
            if (!seenRef.current.has(key)) {
              seenRef.current.add(key);
              setSeen(Array.from(seenRef.current));
              setToast({ kind: "reminder", title: `Meeting in 10 minutes: ${occ.meeting.title}`, body: `Starts at ${new Date(occ.occurrenceStart).toLocaleTimeString()}` });
              window.setTimeout(() => setToast(null), 15000);
              if (browserAllowed) {
                try {
                  new Notification(`Meeting in 10 minutes: ${occ.meeting.title}`, {
                    body: `Starts at ${new Date(occ.occurrenceStart).toLocaleTimeString()}`,
                    icon: "/icon.png",
                    tag: `vaayu-reminder-${occ.meeting.id}-${occ.occurrenceStart}`,
                  });
                } catch {}
              }
              try {
                window.dispatchEvent(new CustomEvent("vaayu:meeting-reminder", { detail: occ }));
              } catch {}
            }
          }
        }
      } catch {}
    };

    void check();
    const iv = setInterval(check, 60 * 1000);
    return () => clearInterval(iv);
  }, [userId]);

  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-2xl border border-hairline bg-ink p-4 text-white shadow-2xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
        {toast.kind === "invite" ? "Meeting invite" : "Reminder · 10 min"}
      </p>
      <p className="mt-1 text-sm font-semibold">{toast.title}</p>
      {toast.body && <p className="mt-0.5 text-xs text-white/70">{toast.body}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={() => setToast(null)} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink">
          Dismiss
        </button>
        <button
          onClick={() => {
            setToast(null);
            try {
              window.location.assign("/calls");
            } catch {}
          }}
          className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold"
        >
          View
        </button>
      </div>
    </div>
  );
}
