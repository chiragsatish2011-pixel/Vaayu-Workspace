"use client";

import { useEffect, useState } from "react";
import { RRule } from "rrule";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";

type UserOpt = { id: string; displayName: string | null; email: string; avatarDriveId?: string | null };
type ProjectOpt = { id: string; title: string };
type EditingMeeting = {
  id: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  callType: "voice" | "video";
  rrule: string | null;
  inviteeIds: string;
  projectId: string | null;
};

function buildRRule(opts: {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  byWeekDay?: number[];
  start: Date;
  endMode: "never" | "count" | "until";
  count?: number;
  until?: string;
}): string | null {
  if (opts.freq === "DAILY" && opts.interval === 1 && opts.endMode === "never" && !opts.byWeekDay?.length) {
    return null;
  }
  const rruleOpts: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: opts.freq === "DAILY" ? RRule.DAILY : RRule.WEEKLY,
    interval: opts.interval,
    dtstart: opts.start,
  };
  if (opts.byWeekDay && opts.byWeekDay.length > 0) {
    rruleOpts.byweekday = opts.byWeekDay.map((d) => [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU][d]!);
  }
  if (opts.endMode === "count" && opts.count) rruleOpts.count = opts.count;
  if (opts.endMode === "until" && opts.until) rruleOpts.until = new Date(opts.until);
  const rule = new RRule(rruleOpts as never);
  return rule.toString();
}

function parseRRuleToState(rrule: string | null, start: Date) {
  if (!rrule) return { repeat: "none" as const, weeklyDays: [1], customInterval: 2, customFreq: "WEEKLY" as const, endMode: "never" as const, count: 10, until: new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 10) };
  try {
    const rule = RRule.fromString(rrule);
    const opts = rule.origOptions;
    const freq = opts.freq === RRule.DAILY ? "DAILY" : "WEEKLY";
    const interval = opts.interval || 1;
    let weeklyDays: number[] = [1];
    if (opts.byweekday) {
      const days = Array.isArray(opts.byweekday) ? opts.byweekday : [opts.byweekday];
      weeklyDays = days.map((d: unknown) => {
        const n = typeof d === "number" ? d : (d as { weekday: number }).weekday;
        return n;
      });
      if (weeklyDays.length === 0) weeklyDays = [1];
    }
    let endMode: "never" | "count" | "until" = "never";
    let count = 10;
    let until = new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 10);
    if (opts.count) {
      endMode = "count";
      count = opts.count;
    } else if (opts.until) {
      endMode = "until";
      until = new Date(opts.until as unknown as string).toISOString().slice(0, 10);
    }
    if (freq === "DAILY" && interval === 1 && weeklyDays.length === 1 && weeklyDays[0] === 1 && endMode === "never") {
      return { repeat: "daily" as const, weeklyDays, customInterval: interval, customFreq: freq, endMode, count, until };
    }
    if (freq === "WEEKLY" && interval === 1) {
      return { repeat: "weekly" as const, weeklyDays, customInterval: interval, customFreq: freq, endMode, count, until };
    }
    return { repeat: "custom" as const, weeklyDays, customInterval: interval, customFreq: freq, endMode, count, until };
  } catch {
    return { repeat: "none" as const, weeklyDays: [1], customInterval: 2, customFreq: "WEEKLY" as const, endMode: "never" as const, count: 10, until: new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 10) };
  }
}

export function ScheduleMeetingModal({
  open,
  onClose,
  onCreated,
  defaultProjectId,
  editingMeeting,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultProjectId?: string | null;
  editingMeeting?: EditingMeeting | null;
}) {
  const isEditing = !!editingMeeting;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toTimeString().slice(0, 5);
  });
  const [duration, setDuration] = useState(30);
  const [callType, setCallType] = useState<"voice" | "video">("video");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "custom">("none");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1]);
  const [customInterval, setCustomInterval] = useState(2);
  const [customFreq, setCustomFreq] = useState<"DAILY" | "WEEKLY">("WEEKLY");
  const [endMode, setEndMode] = useState<"never" | "count" | "until">("never");
  const [count, setCount] = useState(10);
  const [until, setUntil] = useState(() => new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 10));
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResults, setInviteResults] = useState<UserOpt[]>([]);
  const [invitees, setInvitees] = useState<UserOpt[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill when editing
  useEffect(() => {
    if (editingMeeting && open) {
      setTitle(editingMeeting.title);
      const start = new Date(editingMeeting.startTime);
      setDate(start.toISOString().slice(0, 10));
      setTime(start.toTimeString().slice(0, 5));
      setDuration(editingMeeting.durationMinutes);
      setCallType(editingMeeting.callType);
      setProjectId(editingMeeting.projectId);
      const parsed = parseRRuleToState(editingMeeting.rrule, start);
      setRepeat(parsed.repeat);
      setWeeklyDays(parsed.weeklyDays);
      setCustomInterval(parsed.customInterval);
      setCustomFreq(parsed.customFreq as "DAILY" | "WEEKLY");
      setEndMode(parsed.endMode);
      setCount(parsed.count);
      setUntil(parsed.until);
      // Load invitees — resolve display names via mentions search (empty q returns top users)
      try {
        const ids: string[] = JSON.parse(editingMeeting.inviteeIds);
        if (Array.isArray(ids) && ids.length > 0) {
          setInvitees(ids.map((id) => ({ id, displayName: null, email: id.slice(0, 8) })));
          fetch(`/api/mentions/search?q=`, { cache: "no-store" })
            .then((r) => r.json().catch(() => null))
            .then((d) => {
              const people: Array<{ id: string; label: string; sublabel: string }> = Array.isArray(d?.results)
                ? d.results.filter((x: { type: string }) => x.type === "person")
                : [];
              if (people.length > 0) {
                const byId = new Map(people.map((p) => [p.id, p]));
                setInvitees(ids.map((id) => {
                  const hit = byId.get(id);
                  return hit ? { id, displayName: hit.label, email: hit.sublabel } : { id, displayName: null, email: id.slice(0, 8) };
                }));
              }
            })
            .catch(() => {});
        } else {
          setInvitees([]);
        }
      } catch {
        setInvitees([]);
      }
    } else if (!editingMeeting && open) {
      // Reset for create
      setTitle("");
      const d = new Date(Date.now() + 60 * 60 * 1000);
      setDate(new Date().toISOString().slice(0, 10));
      setTime(d.toTimeString().slice(0, 5));
      setDuration(30);
      setCallType("video");
      setRepeat("none");
      setWeeklyDays([1]);
      setInvitees([]);
      setProjectId(defaultProjectId ?? null);
      setError(null);
    }
  }, [editingMeeting, open, defaultProjectId]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (Array.isArray(d?.projects)) setProjects(d.projects.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })));
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!inviteSearch.trim()) {
      setInviteResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(inviteSearch)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        const people = Array.isArray(data?.results) ? data.results.filter((r: { type: string }) => r.type === "person") : [];
        setInviteResults(
          people.slice(0, 6).map((p: { id: string; label: string; sublabel: string }) => ({ id: p.id, displayName: p.label, email: p.sublabel }))
        );
      } catch {
        setInviteResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [inviteSearch]);

  const toggleDay = (d: number) => {
    setWeeklyDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    if (isNaN(start.getTime())) {
      setError("Invalid date/time.");
      return;
    }
    let rrule: string | null = null;
    if (repeat !== "none") {
      if (repeat === "daily") {
        rrule = buildRRule({ freq: "DAILY", interval: 1, start, endMode, count, until });
        if (!rrule) rrule = new RRule({ freq: RRule.DAILY, dtstart: start }).toString();
      } else if (repeat === "weekly") {
        rrule = buildRRule({ freq: "WEEKLY", interval: 1, byWeekDay: weeklyDays, start, endMode, count, until }) || new RRule({ freq: RRule.WEEKLY, byweekday: weeklyDays.map((d) => [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU][d]!), dtstart: start }).toString();
      } else if (repeat === "custom") {
        rrule = buildRRule({ freq: customFreq, interval: customInterval, byWeekDay: customFreq === "WEEKLY" ? weeklyDays : undefined, start, endMode, count, until });
        if (!rrule) rrule = new RRule({ freq: customFreq === "DAILY" ? RRule.DAILY : RRule.WEEKLY, interval: customInterval, dtstart: start }).toString();
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const url = isEditing ? "/api/scheduled-meetings" : "/api/scheduled-meetings";
      const method = isEditing ? "PATCH" : "POST";
      const body: Record<string, unknown> = isEditing
        ? { id: editingMeeting!.id, title: title.trim(), startTime: start.toISOString(), durationMinutes: duration, callType, rrule, inviteeIds: invitees.map((u) => u.id), projectId }
        : { title: title.trim(), startTime: start.toISOString(), durationMinutes: duration, callType, rrule, inviteeIds: invitees.map((u) => u.id), projectId };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to save.");
      onCreated();
      onClose();
      if (!isEditing) {
        setTitle("");
        setInvitees([]);
        setInviteSearch("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-hairline bg-canvas p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{isEditing ? "Edit meeting" : "Schedule a meeting"}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-fog">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning" maxLength={100} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink" />
            </div>
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Start time *</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Duration (minutes)</label>
              <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value, 10))} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink">
                {[15, 30, 45, 60, 90, 120].map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Call type</label>
              <select value={callType} onChange={(e) => setCallType(e.target.value as "voice" | "video")} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink">
                <option value="video">Video</option>
                <option value="voice">Voice</option>
              </select>
            </div>
          </div>

          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Recurrence</label>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as never)} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom</option>
            </select>
            {repeat === "weekly" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  { label: "Mon", v: 0 },
                  { label: "Tue", v: 1 },
                  { label: "Wed", v: 2 },
                  { label: "Thu", v: 3 },
                  { label: "Fri", v: 4 },
                  { label: "Sat", v: 5 },
                  { label: "Sun", v: 6 },
                ].map((d) => (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border ${weeklyDays.includes(d.v) ? "bg-ink text-white border-ink" : "bg-fog text-ink border-hairline"}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
            {repeat === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs">Every</span>
                <input type="number" min={1} max={30} value={customInterval} onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-16 rounded-lg border border-hairline px-2 py-1 text-sm" />
                <select value={customFreq} onChange={(e) => setCustomFreq(e.target.value as never)} className="rounded-lg border border-hairline px-2 py-1 text-sm">
                  <option value="DAILY">days</option>
                  <option value="WEEKLY">weeks</option>
                </select>
                {customFreq === "WEEKLY" && (
                  <span className="flex gap-1">
                    {["M", "T", "W", "T", "F", "S", "S"].map((lbl, idx) => (
                      <button key={idx} type="button" onClick={() => toggleDay(idx)} className={`h-6 w-6 rounded-full text-[10px] font-bold ${weeklyDays.includes(idx) ? "bg-ink text-white" : "bg-fog border border-hairline"}`}>
                        {lbl}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )}
            {repeat !== "none" && (
              <div className="mt-2 space-y-2 rounded-xl border border-hairline-soft bg-fog/30 p-3">
                <p className="font-mono text-[11px] uppercase tracking-wider text-steel">End condition</p>
                <label className="flex items-center gap-2 text-xs">
                  <input type="radio" checked={endMode === "never"} onChange={() => setEndMode("never")} /> Never
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="radio" checked={endMode === "count"} onChange={() => setEndMode("count")} /> After{" "}
                  <input type="number" value={count} onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))} disabled={endMode !== "count"} className="w-16 rounded border border-hairline px-1 py-0.5 text-xs" /> occurrences
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="radio" checked={endMode === "until"} onChange={() => setEndMode("until")} /> On{" "}
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} disabled={endMode !== "until"} className="rounded border border-hairline px-1 py-0.5 text-xs" />
                </label>
              </div>
            )}
          </div>

          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Invitees</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {invitees.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-fog px-2.5 py-1 text-xs">
                  <UserAvatar displayName={u.displayName} email={u.email} size={18} />
                  {getDisplayName(u.displayName, u.email)}
                  <button type="button" onClick={() => setInvitees((prev) => prev.filter((x) => x.id !== u.id))} className="ml-1 text-steel hover:text-ink">
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <input
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Type @ name or email to add invitees"
              className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm outline-none focus:border-ink"
            />
            {inviteResults.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto rounded-xl border border-hairline bg-canvas shadow">
                {inviteResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      if (!invitees.find((x) => x.id === u.id)) setInvitees((prev) => [...prev, u]);
                      setInviteSearch("");
                      setInviteResults([]);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fog"
                  >
                    <UserAvatar displayName={u.displayName} email={u.email} size={24} />
                    <span className="truncate">{getDisplayName(u.displayName, u.email)}</span>
                    <span className="truncate font-mono text-xs text-steel">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Link to project (optional)</label>
            <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} className="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink">
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold hover:border-ink">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white hover:bg-charcoal disabled:opacity-50">
              {submitting ? (isEditing ? "Saving…" : "Scheduling…") : isEditing ? "Save" : "Schedule"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
