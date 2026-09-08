"use client";

import { useEffect, useState } from "react";
import { VoiceCall } from "./VoiceCall";
import { VideoCall } from "./VideoCall";
import { StandaloneActiveCalls } from "./ActiveCallIndicator";
import { CallNotificationPrePrompt, CallNotificationBlockedNotice } from "./CallNotificationPrePrompt";
import { IncomingCallBanner } from "./IncomingCallBanner";

type HistoryCall = {
  id: string;
  type: "voice" | "video";
  context: string;
  contextId: string | null;
  dailyRoomName: string;
  dailyRoomUrl: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
};

function CallHistory({ currentUserId, currentUserRole }: { currentUserId: string | null; currentUserRole: "admin" | "member" }) {
  const [calls, setCalls] = useState<HistoryCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/calls/rooms?history=1", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load history");
      setCalls(Array.isArray(data?.calls) ? data.calls : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const canDelete = (c: HistoryCall) => c.createdBy === currentUserId || currentUserRole === "admin";

  const doDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    const confirmMsg =
      ids.length === 1
        ? "Delete this call record permanently? This will hard-delete it from the database and try to remove the Daily.co room. This cannot be undone."
        : `Delete ${ids.length} call records permanently? This will hard-delete them from the database and try to remove their Daily.co rooms. This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const isBulk = ids.length > 1;
    if (isBulk) setBulkDeleting(true);
    else setDeleting(ids[0]!);

    setError(null);
    try {
      const res = await fetch("/api/calls/rooms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      setCalls((prev) => prev.filter((c) => !ids.includes(c.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
      setBulkDeleting(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const deletableIds = calls.filter(canDelete).map((c) => c.id);
    if (selected.size === deletableIds.length) setSelected(new Set());
    else setSelected(new Set(deletableIds));
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-hairline bg-canvas p-5">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Call history</p>
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-fog" />
      </div>
    );
  }

  const deletableCount = calls.filter(canDelete).length;

  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Call history</p>
          <p className="mt-1 text-xs text-steel">
            {calls.length === 0 ? "No calls yet — history will appear here." : `${calls.length} total · ${deletableCount} deletable by you`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="font-mono text-xs text-ink">{selected.size} selected</span>
              <button
                onClick={() => void doDelete(Array.from(selected))}
                disabled={bulkDeleting}
                className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
              >
                {bulkDeleting ? "Deleting…" : `Delete ${selected.size}`}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-steel underline">
                Clear
              </button>
            </>
          )}
          <button onClick={() => void load()} className="rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold hover:border-ink">
            Refresh
          </button>
        </div>
      </div>

      {calls.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={selected.size > 0 && selected.size === deletableCount} onChange={toggleAll} className="h-3 w-3" />
            Select all deletable
          </label>
          <span className="font-mono text-[11px] text-stone">Hard delete — not soft-hide. Daily room also removed if possible. Recordings are currently disabled (out of scope).</span>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {calls.length === 0 ? (
        <p className="mt-4 text-sm text-steel">No history yet. Create a call above to see it here.</p>
      ) : (
        <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {calls.map((c) => {
            const expired = new Date(c.expiresAt).getTime() < Date.now();
            const isDeletable = canDelete(c);
            const isSelected = selected.has(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${isSelected ? "border-ink bg-fog" : "border-hairline bg-fog/50"}`}>
                <input type="checkbox" checked={isSelected} disabled={!isDeletable} onChange={() => toggle(c.id)} className="h-4 w-4" title={isDeletable ? "Select" : "Only organizer or Admin can delete"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold capitalize">
                    {c.type} <span className="font-mono text-xs font-normal text-steel">· {c.context}{c.contextId ? `:${c.contextId.slice(0, 6)}` : ""} · {c.dailyRoomName.slice(0, 18)}</span>
                    {expired && <span className="ml-2 rounded-full bg-stone/10 px-2 py-0.5 font-mono text-[10px] text-stone">expired</span>}
                  </p>
                  <p className="font-mono text-[11px] text-steel">
                    {new Date(c.createdAt).toLocaleString()} · by {c.createdBy ? c.createdBy.slice(0, 8) : "unknown"}
                    {!isDeletable && " · not deletable by you"}
                  </p>
                </div>
                <button
                  onClick={() => void doDelete([c.id])}
                  disabled={!isDeletable || deleting === c.id || bulkDeleting}
                  className="shrink-0 rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold text-ink hover:border-error hover:text-error disabled:opacity-40"
                  title={isDeletable ? "Hard-delete this call record permanently" : "Only organizer or Admin"}
                >
                  {deleting === c.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CallsHub({ displayName, userId, userRole }: { displayName: string; userId?: string | null; userRole?: "admin" | "member" }) {
  const [active, setActive] = useState<{ url: string; type: "voice" | "video"; name: string } | null>(null);
  const [creating, setCreating] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createCall = async (type: "voice" | "video", context: "standalone" | "project" | "checkpoint" = "standalone", contextId?: string) => {
    setCreating(type);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/calls/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, context, contextId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not create room");
      const url: string = data.dailyRoomUrl;
      const name: string = data.dailyRoomName;
      setActive({ url, type, name });
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/calls?join=${encodeURIComponent(name)}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create call");
    } finally {
      setCreating(null);
    }
  };

  const leave = () => {
    setActive(null);
    setCopied(false);
    // Clean URL param if present
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("join")) {
        u.searchParams.delete("join");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {}
  };

  // Handle ?join= param — fetch calls list and auto-join the matching room
  useEffect(() => {
    if (active || creating) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const joinName = params.get("join");
      if (!joinName) return;
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch("/api/calls/rooms", { cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.calls) return;
          const found = (data.calls as { dailyRoomName: string; dailyRoomUrl: string; type: "voice" | "video" }[]).find((c) => c.dailyRoomName === joinName);
          if (found && !cancelled) {
            setActive({ url: found.dailyRoomUrl, type: found.type, name: found.dailyRoomName });
          }
        } catch {}
      })();
      return () => {
        cancelled = true;
      };
    } catch {}
  }, [active, creating]);

  if (active) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={leave} className="rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold hover:border-ink">
            ← Back to Calls hub
          </button>
          {copied && <span className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-white">Invite link copied</span>}
        </div>
        <div className="h-[560px] sm:h-[640px]">
          {active.type === "voice" ? (
            <VoiceCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          ) : (
            <VideoCall url={active.url} displayName={displayName} onLeave={leave} onError={(m) => setError(m)} />
          )}
        </div>
        {error && (
          <div className="rounded-xl border border-hairline bg-canvas px-4 py-3 text-sm text-steel">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <CallNotificationPrePrompt userId={userId} />
      <CallNotificationBlockedNotice />
      <IncomingCallBanner activeUrl={null} onJoin={(call) => setActive({ url: call.dailyRoomUrl, type: call.type, name: call.dailyRoomName })} userId={userId} />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Voice card — polished, no debug jargon */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-[#0a0a0a] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/[0.07] blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/60">Audio first</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Voice Call</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/70">Start with camera off and add video anytime. Screen sharing is built in.</p>
          <button
            onClick={() => createCall("voice")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "voice" ? "Creating…" : "Start Voice Call →"}
          </button>
        </div>

        {/* Video card — polished, no technical footnotes */}
        <div className="group relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-[#0e7a64] via-[#14b8a6] to-[#14b8a6] p-6 text-white shadow-sm">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/80">Camera on</p>
          <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Video Call</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/90">Grid view with active-speaker highlight. Mute, camera, and screen sharing in one bar.</p>
          <button
            onClick={() => createCall("video")}
            disabled={!!creating}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-900 hover:bg-white/90 disabled:opacity-50"
          >
            {creating === "video" ? "Creating…" : "Start Video Call →"}
          </button>
        </div>
      </div>

      <StandaloneActiveCalls onJoin={(call) => setActive({ url: call.dailyRoomUrl, type: call.type, name: call.dailyRoomName })} />

      <CallHistory currentUserId={userId ?? null} currentUserRole={userRole ?? "member"} />

      <div className="rounded-2xl border border-hairline bg-fog/50 p-5">
        <p className="text-sm font-semibold text-ink">How invites work</p>
        <p className="mt-1 text-sm leading-relaxed text-steel">
          Starting a call creates a room you can share. Teammates viewing Calls see <span className="font-semibold">“Call in progress — Join”</span> and can hop in instantly. An invite link is also copied for you to paste anywhere.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-canvas p-5">
        <p className="text-sm font-semibold">Screen sharing</p>
        <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-steel space-y-1">
          <li>Choose a screen, window, or browser tab when prompted — others see it live.</li>
          <li>Works in both Voice and Video calls.</li>
        </ul>
      </div>
    </div>
  );
}
