"use client";

import { useEffect, useState, useCallback } from "react";
import { ActiveUser } from "@/lib/session";
import {
  BoltIcon,
  CheckIcon,
  CloseIcon,
  CpuIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
} from "@/components/icons";

interface Session {
  name: string; // e.g. "sessions/12345"
  id: string;
  title?: string;
  prompt: string;
  state:
    | "STATE_UNSPECIFIED"
    | "QUEUED"
    | "PLANNING"
    | "AWAITING_PLAN_APPROVAL"
    | "AWAITING_USER_FEEDBACK"
    | "IN_PROGRESS"
    | "PAUSED"
    | "FAILED"
    | "COMPLETED";
  archived?: boolean;
  createTime?: string;
  updateTime?: string;
  url?: string;
  requirePlanApproval?: boolean;
  automationMode?: string;
  sourceContext?: {
    source?: string;
    githubRepoContext?: {
      repo?: string;
      startingBranch?: string;
    };
  };
}

interface Activity {
  name: string;
  id?: string;
  description?: string;
  originator?: "user" | "agent" | "system" | string;
  createTime?: string;
  agentMessaged?: { message?: string };
  userMessaged?: { message?: string };
  planGenerated?: {
    plan?: {
      steps?: Array<{ id?: string; index?: number; title?: string; description?: string }>;
    };
  };
  planApproved?: { approvedBy?: string };
  progressUpdated?: { message?: string };
  sessionCompleted?: { message?: string };
  sessionFailed?: { reason?: string };
  artifacts?: Array<{
    name?: string;
    changeSet?: {
      source?: string;
      gitPatch?: { patch?: string };
    };
  }>;
}

interface Source {
  name: string; // e.g. "sources/12345"
  id: string;
  githubRepo?: {
    owner?: string;
    repo?: string;
    isPrivate?: boolean;
    defaultBranch?: { displayName?: string };
  };
}

interface SessionStats {
  used24h: number;
  total24hLimit: number;
  remaining24h: number;
  activeConcurrent: number;
  maxConcurrentLimit: number;
  remainingConcurrent: number;
}

export function VaayuWorkerClient({ user }: { user: ActiveUser }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    used24h: 0,
    total24hLimit: 100,
    remaining24h: 100,
    activeConcurrent: 0,
    maxConcurrentLimit: 10,
    remainingConcurrent: 10,
  });
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [filter, setFilter] = useState<"all" | "active" | "awaiting" | "completed" | "archived">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals & Active Session
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Create Form State
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newBranch, setNewBranch] = useState("main");
  const [requireApproval, setRequireApproval] = useState(true);
  const [autoPR, setAutoPR] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Message Sending State
  const [userMsg, setUserMsg] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch Session List & Stats
  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/worker/sessions");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch sessions");
      }
      setSessions(data.sessions || []);
      if (data.stats) {
        setStats(data.stats);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load Vaayu Worker sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Sources List
  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/worker/sources");
      const data = await res.json();
      if (res.ok && data.sources) {
        setSources(data.sources);
      }
    } catch {
      // sources fetch error handled gracefully
    }
  }, []);

  // Fetch Detailed Session & Activity Feed
  const fetchSessionDetails = useCallback(async (sessionId: string) => {
    try {
      setLoadingDetails(true);
      setActionError(null);
      const rawId = sessionId.replace(/^sessions\//, "");
      const res = await fetch(`/api/worker/sessions/${rawId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch session details");
      }
      setActiveSession(data.session);
      setActivities(data.activities || []);
    } catch (err: any) {
      setActionError(err.message || "Failed to load session details");
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchSources();
  }, [fetchSessions, fetchSources]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionDetails(selectedSessionId);
      // Auto refresh activity feed every 6 seconds when drawer is open
      const interval = setInterval(() => {
        fetchSessionDetails(selectedSessionId);
      }, 6000);
      return () => clearInterval(interval);
    } else {
      setActiveSession(null);
      setActivities([]);
    }
  }, [selectedSessionId, fetchSessionDetails]);

  // Handle Session Creation
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrompt.trim()) return;

    try {
      setSubmitting(true);
      setCreateError(null);

      const sourceContext = newSource.trim()
        ? {
            source: newSource,
            githubRepoContext: newBranch.trim()
              ? { startingBranch: newBranch.trim() }
              : undefined,
          }
        : undefined;

      const body = {
        prompt: newPrompt,
        title: newTitle || undefined,
        sourceContext,
        requirePlanApproval: requireApproval,
        automationMode: autoPR ? "AUTO_CREATE_PR" : "AUTOMATION_MODE_UNSPECIFIED",
      };

      const res = await fetch("/api/worker/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create session");
      }

      // Reset form & reload
      setNewPrompt("");
      setNewTitle("");
      setNewSource("");
      setNewBranch("main");
      setShowCreateModal(false);
      await fetchSessions();

      if (data.session?.name || data.session?.id) {
        setSelectedSessionId(data.session.name || data.session.id);
      }
    } catch (err: any) {
      setCreateError(err.message || "Error creating session");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Plan Approval
  const handleApprovePlan = async () => {
    if (!selectedSessionId) return;
    const rawId = selectedSessionId.replace(/^sessions\//, "");
    try {
      setApprovingPlan(true);
      setActionError(null);
      const res = await fetch(`/api/worker/sessions/${rawId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve plan");
      await fetchSessionDetails(selectedSessionId);
      await fetchSessions();
    } catch (err: any) {
      setActionError(err.message || "Failed to approve plan");
    } finally {
      setApprovingPlan(false);
    }
  };

  // Handle Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId || !userMsg.trim()) return;
    const rawId = selectedSessionId.replace(/^sessions\//, "");
    try {
      setSendingMsg(true);
      setActionError(null);
      const res = await fetch(`/api/worker/sessions/${rawId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMsg.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");
      setUserMsg("");
      await fetchSessionDetails(selectedSessionId);
    } catch (err: any) {
      setActionError(err.message || "Failed to send message");
    } finally {
      setSendingMsg(false);
    }
  };

  // Handle Admin Actions (Archive / Unarchive / Delete)
  const handleAdminAction = async (action: "archive" | "unarchive" | "delete") => {
    if (!selectedSessionId) return;
    if (user.role !== "admin") {
      setActionError("Only Workspace Admins can stop, pause, archive, or delete sessions.");
      return;
    }

    if (action === "delete") {
      if (!confirm("Are you sure you want to delete this session? This action cannot be undone.")) {
        return;
      }
    }

    const rawId = selectedSessionId.replace(/^sessions\//, "");
    try {
      setActionError(null);
      const url =
        action === "delete"
          ? `/api/worker/sessions/${rawId}`
          : `/api/worker/sessions/${rawId}/${action}`;

      const method = action === "delete" ? "DELETE" : "POST";

      const res = await fetch(url, { method });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} session`);

      if (action === "delete") {
        setSelectedSessionId(null);
      } else {
        await fetchSessionDetails(selectedSessionId);
      }
      await fetchSessions();
    } catch (err: any) {
      setActionError(err.message || `Failed to perform ${action}`);
    }
  };

  // Filtered Sessions
  const filteredSessions = sessions.filter((s) => {
    const isArchived = Boolean(s.archived);
    if (filter === "archived") {
      if (!isArchived) return false;
    } else {
      if (isArchived) return false;
      if (filter === "active") {
        if (s.state === "COMPLETED" || s.state === "FAILED") return false;
      } else if (filter === "awaiting") {
        if (s.state !== "AWAITING_PLAN_APPROVAL" && s.state !== "AWAITING_USER_FEEDBACK")
          return false;
      } else if (filter === "completed") {
        if (s.state !== "COMPLETED") return false;
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = (s.title || "").toLowerCase().includes(q);
      const promptMatch = (s.prompt || "").toLowerCase().includes(q);
      const idMatch = (s.id || s.name || "").toLowerCase().includes(q);
      return titleMatch || promptMatch || idMatch;
    }

    return true;
  });

  return (
    <div className="space-y-6 pt-6">
      {/* ── Banner & Quota Readout (Golden Brand Theme) ── */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-white font-bold shadow-md shadow-amber-500/20">
                <CpuIcon className="h-5 w-5" />
              </span>
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                Vaayu Worker
              </h1>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                Google Jules Agent
              </span>
            </div>
            <p className="mt-1.5 text-sm text-charcoal">
              Autonomous engineering agent powered by Google Jules API. Delegate development tasks, review execution plans, and track live PR patches.
            </p>
          </div>

          {/* Sessions Used / Remaining & Concurrent Limit Badges */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-amber-200/80 bg-white/80 p-3 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-stone">
                24h Quota Used
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-display text-xl font-bold text-amber-600">
                  {stats.used24h}
                </span>
                <span className="font-mono text-xs text-steel">
                  / {stats.total24hLimit}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-emerald-600">
                {stats.remaining24h} sessions remaining
              </div>
            </div>

            <div className="rounded-xl border border-amber-200/80 bg-white/80 p-3 shadow-xs">
              <div className="font-mono text-[10px] uppercase tracking-wider text-stone">
                Active Concurrent
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-display text-xl font-bold text-amber-600">
                  {stats.activeConcurrent}
                </span>
                <span className="font-mono text-xs text-steel">
                  / {stats.maxConcurrentLimit} max
                </span>
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-stone">
                {stats.remainingConcurrent} slots free
              </div>
            </div>

            <div className="col-span-2 rounded-xl border border-amber-200/80 bg-white/80 p-3 shadow-xs sm:col-span-1">
              <div className="font-mono text-[10px] uppercase tracking-wider text-stone">
                Jules API Status
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-semibold text-ink">Connected</span>
              </div>
              <div className="mt-1.5 text-[11px] font-mono text-steel">
                jules.googleapis.com
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar: Search, Filters & Action Button ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-stone" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="h-9 w-full rounded-lg border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink outline-none transition focus:border-amber-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center rounded-lg border border-hairline bg-fog p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === "all" ? "bg-white font-semibold text-ink shadow-xs" : "text-stone hover:text-ink"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter("active")}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === "active" ? "bg-white font-semibold text-ink shadow-xs" : "text-stone hover:text-ink"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setFilter("awaiting")}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === "awaiting" ? "bg-white font-semibold text-amber-700 shadow-xs" : "text-stone hover:text-ink"
              }`}
            >
              Needs Action
            </button>
            <button
              type="button"
              onClick={() => setFilter("completed")}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === "completed" ? "bg-white font-semibold text-ink shadow-xs" : "text-stone hover:text-ink"
              }`}
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => setFilter("archived")}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === "archived" ? "bg-white font-semibold text-ink shadow-xs" : "text-stone hover:text-ink"
              }`}
            >
              Archived
            </button>
          </div>
        </div>

        {/* Create Session CTA */}
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="press inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/20 hover:bg-amber-600"
        >
          <PlusIcon className="h-4 w-4" />
          <span>New Jules Session</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Sessions List View ── */}
      {loading ? (
        <div className="py-12 text-center font-mono text-sm text-stone">
          Loading Vaayu Worker sessions...
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline p-12 text-center">
          <CpuIcon className="mx-auto h-10 w-10 text-stone/60" />
          <h3 className="mt-3 font-display text-base font-semibold text-ink">
            No sessions found
          </h3>
          <p className="mt-1 text-sm text-stone">
            {searchQuery
              ? "No sessions match your search criteria."
              : filter === "archived"
              ? "There are no archived sessions."
              : "Dispatch your first engineering task to Vaayu Worker to get started."}
          </p>
          {!searchQuery && filter === "all" && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="press mt-4 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Create First Session</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredSessions.map((session) => {
            const sid = session.name || session.id;
            const stateInfo = getStateBadge(session.state, session.archived);

            return (
              <div
                key={sid}
                onClick={() => setSelectedSessionId(sid)}
                className={`group cursor-pointer rounded-2xl border bg-white p-5 transition-all duration-200 hover:shadow-md ${
                  selectedSessionId === sid
                    ? "border-amber-500 ring-1 ring-amber-500"
                    : "border-hairline hover:border-amber-300"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${stateInfo.bg} ${stateInfo.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${stateInfo.dot}`} />
                        {stateInfo.label}
                      </span>
                      {session.archived && (
                        <span className="rounded-full bg-stone/10 px-2 py-0.5 font-mono text-[10px] text-stone">
                          Archived
                        </span>
                      )}
                      <span className="font-mono text-xs text-stone">
                        {session.createTime
                          ? new Date(session.createTime).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>

                    <h2 className="mt-2 text-base font-semibold text-ink group-hover:text-amber-600 transition-colors">
                      {session.title || session.prompt.slice(0, 80) + "..."}
                    </h2>

                    <p className="mt-1 line-clamp-2 text-sm text-charcoal">
                      {session.prompt}
                    </p>

                    {session.sourceContext?.githubRepoContext?.repo && (
                      <div className="mt-2.5 flex items-center gap-2 text-xs text-steel">
                        <span className="font-mono text-[11px] rounded bg-fog px-1.5 py-0.5">
                          {session.sourceContext.githubRepoContext.repo}
                        </span>
                        {session.sourceContext.githubRepoContext.startingBranch && (
                          <span className="font-mono text-[11px] text-stone">
                            branch: {session.sourceContext.githubRepoContext.startingBranch}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 sm:self-center">
                    {session.state === "AWAITING_PLAN_APPROVAL" && (
                      <span className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 animate-pulse">
                        Action Required: Approve Plan
                      </span>
                    )}
                    <span className="rounded-lg border border-hairline bg-fog px-3 py-1.5 text-xs font-medium text-ink group-hover:bg-amber-50 group-hover:border-amber-200">
                      View Session &rarr;
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── New Session Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl border border-hairline bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-fog/50">
              <div className="flex items-center gap-2">
                <CpuIcon className="h-5 w-5 text-amber-500" />
                <h2 className="font-display text-lg font-bold text-ink">
                  Dispatch New Task to Jules
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-full p-1 text-stone hover:bg-canvas hover:text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4">
              {createError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone mb-1">
                  Session Title (Optional)
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Add dark mode toggle component"
                  className="w-full rounded-xl border border-hairline px-3.5 py-2 text-sm text-ink outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone mb-1">
                  Prompt / Instructions <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Describe what you want Vaayu Worker to build or fix in detail..."
                  className="w-full rounded-xl border border-hairline p-3.5 text-sm text-ink outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone mb-1">
                    Select Source Repository
                  </label>
                  {sources.length > 0 ? (
                    <select
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      className="w-full rounded-xl border border-hairline px-3.5 py-2 text-sm text-ink outline-none focus:border-amber-500"
                    >
                      <option value="">(None / Start from scratch)</option>
                      {sources.map((s) => (
                        <option key={s.name || s.id} value={s.name || s.id}>
                          {s.githubRepo?.owner && s.githubRepo?.repo
                            ? `${s.githubRepo.owner}/${s.githubRepo.repo}`
                            : s.name || s.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      placeholder="e.g. sources/my-repo"
                      className="w-full rounded-xl border border-hairline px-3.5 py-2 text-sm text-ink outline-none focus:border-amber-500"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone mb-1">
                    Target Branch
                  </label>
                  <input
                    type="text"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-xl border border-hairline px-3.5 py-2 text-sm text-ink outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-hairline">
                <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={requireApproval}
                    onChange={(e) => setRequireApproval(e.target.checked)}
                    className="h-4 w-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span>Require Plan Approval before agent executes code</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={autoPR}
                    onChange={(e) => setAutoPR(e.target.checked)}
                    className="h-4 w-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span>Automatically create GitHub Pull Request when completed</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-hairline px-4 py-2 text-sm font-medium text-stone hover:bg-fog"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !newPrompt.trim()}
                  className="press rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/20 hover:bg-amber-600 disabled:opacity-50"
                >
                  {submitting ? "Dispatching..." : "Dispatch Worker Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Session Detail & Activity Drawer ── */}
      {selectedSessionId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl border-l border-hairline">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-canvas">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-stone">
                    {selectedSessionId}
                  </span>
                  {activeSession?.state && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStateBadge(activeSession.state, activeSession.archived).bg} ${getStateBadge(activeSession.state, activeSession.archived).text}`}>
                      {getStateBadge(activeSession.state, activeSession.archived).label}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 font-display text-lg font-bold text-ink truncate">
                  {activeSession?.title || activeSession?.prompt || "Session Details"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSessionId(null)}
                className="rounded-full p-2 text-stone hover:bg-fog hover:text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Action Bar & Admin Controls */}
            {activeSession && (
              <div className="border-b border-hairline bg-fog/40 px-6 py-3 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  {activeSession.state === "AWAITING_PLAN_APPROVAL" && (
                    <button
                      type="button"
                      onClick={handleApprovePlan}
                      disabled={approvingPlan}
                      className="press inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckIcon className="h-4 w-4" />
                      <span>{approvingPlan ? "Approving..." : "Approve Execution Plan"}</span>
                    </button>
                  )}
                  {activeSession.url && (
                    <a
                      href={activeSession.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 font-medium text-steel hover:text-ink"
                    >
                      Open in Jules Web &rarr;
                    </a>
                  )}
                </div>

                {/* Admin-only controls warning/buttons */}
                {user.role === "admin" ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase text-stone flex items-center gap-1">
                      <ShieldIcon className="h-3.5 w-3.5 text-amber-600" /> Admin
                    </span>
                    {activeSession.archived ? (
                      <button
                        type="button"
                        onClick={() => handleAdminAction("unarchive")}
                        className="rounded bg-canvas border border-hairline px-2 py-1 font-medium text-stone hover:text-ink"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAdminAction("archive")}
                        className="rounded bg-canvas border border-hairline px-2 py-1 font-medium text-stone hover:text-ink"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAdminAction("delete")}
                      className="rounded bg-red-50 border border-red-200 px-2 py-1 font-medium text-red-600 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div className="font-mono text-[11px] text-stone">
                    Read-only (Admin required to stop/archive/delete)
                  </div>
                )}
              </div>
            )}

            {actionError && (
              <div className="mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {actionError}
              </div>
            )}

            {/* Activities Timeline Container */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {loadingDetails ? (
                <div className="py-12 text-center font-mono text-sm text-stone">
                  Loading activity timeline...
                </div>
              ) : activities.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone">
                  No activities recorded yet for this session.
                </div>
              ) : (
                activities.map((act) => (
                  <ActivityCard key={act.name || act.id} activity={act} />
                ))
              )}
            </div>

            {/* Send User Feedback / Message Bar */}
            <form
              onSubmit={handleSendMessage}
              className="border-t border-hairline bg-canvas p-4"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userMsg}
                  onChange={(e) => setUserMsg(e.target.value)}
                  placeholder="Send instructions or feedback to Jules agent..."
                  className="flex-1 rounded-xl border border-hairline bg-white px-3.5 py-2 text-sm outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={sendingMsg || !userMsg.trim()}
                  className="press rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                  {sendingMsg ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Activity Item Renderer
function ActivityCard({ activity }: { activity: Activity }) {
  const isAgent = activity.originator === "agent" || activity.agentMessaged || activity.planGenerated;
  const isUser = activity.originator === "user" || activity.userMessaged;

  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        isUser
          ? "border-azure-soft bg-blue-50/40 ml-4"
          : isAgent
          ? "border-amber-200/80 bg-amber-50/20 mr-2"
          : "border-hairline bg-fog/30"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-stone mb-2">
        <span className="font-semibold uppercase tracking-wider text-ink flex items-center gap-1.5">
          {isAgent ? (
            <>
              <CpuIcon className="h-3.5 w-3.5 text-amber-600" /> Jules Agent
            </>
          ) : isUser ? (
            <>User Message</>
          ) : (
            <>System Event</>
          )}
        </span>
        <span className="font-mono text-[10px]">
          {activity.createTime
            ? new Date(activity.createTime).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : ""}
        </span>
      </div>

      {/* Description / Summary */}
      {activity.description && (
        <p className="text-charcoal font-medium">{activity.description}</p>
      )}

      {/* Agent Text Message */}
      {activity.agentMessaged?.message && (
        <div className="mt-1 whitespace-pre-wrap text-ink font-mono text-xs bg-white/80 p-3 rounded-lg border border-hairline">
          {activity.agentMessaged.message}
        </div>
      )}

      {/* User Text Message */}
      {activity.userMessaged?.message && (
        <div className="mt-1 whitespace-pre-wrap text-ink text-sm">
          {activity.userMessaged.message}
        </div>
      )}

      {/* Generated Plan Display */}
      {activity.planGenerated?.plan?.steps && (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3.5">
          <div className="font-display font-bold text-amber-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
            <BoltIcon className="h-4 w-4 text-amber-600" /> Proposed Execution Plan
          </div>
          <ol className="list-decimal list-inside space-y-1.5 pt-1 text-xs text-amber-950 font-medium">
            {activity.planGenerated.plan.steps.map((step, idx) => (
              <li key={step.id || idx} className="leading-relaxed">
                <span className="font-semibold">{step.title || `Step ${idx + 1}`}</span>
                {step.description && (
                  <p className="pl-4 font-normal text-stone text-[11px]">
                    {step.description}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Code Patches / Artifacts */}
      {activity.artifacts && activity.artifacts.length > 0 && (
        <div className="mt-3 space-y-2">
          {activity.artifacts.map((art, idx) => {
            const patch = art.changeSet?.gitPatch?.patch;
            return (
              <div key={idx} className="rounded-lg border border-hairline bg-slate-900 p-3 text-white">
                <div className="font-mono text-[11px] text-amber-400 mb-1">
                  Git Patch Artifact
                </div>
                {patch ? (
                  <pre className="overflow-x-auto text-[11px] font-mono leading-relaxed text-slate-200 max-h-48 p-2 bg-slate-950 rounded">
                    {patch}
                  </pre>
                ) : (
                  <span className="text-xs text-slate-400">
                    {art.name || "Code change artifact generated."}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Utility function for session state badges
function getStateBadge(state: string, archived?: boolean) {
  if (archived) {
    return {
      label: "Archived",
      bg: "bg-stone/10",
      text: "text-stone",
      dot: "bg-stone",
    };
  }

  switch (state) {
    case "AWAITING_PLAN_APPROVAL":
      return {
        label: "Awaiting Plan Approval",
        bg: "bg-amber-100",
        text: "text-amber-800",
        dot: "bg-amber-500",
      };
    case "AWAITING_USER_FEEDBACK":
      return {
        label: "Awaiting User Feedback",
        bg: "bg-amber-100",
        text: "text-amber-800",
        dot: "bg-amber-500",
      };
    case "IN_PROGRESS":
    case "PLANNING":
      return {
        label: "In Progress",
        bg: "bg-blue-100",
        text: "text-blue-800",
        dot: "bg-blue-500",
      };
    case "QUEUED":
      return {
        label: "Queued",
        bg: "bg-purple-100",
        text: "text-purple-800",
        dot: "bg-purple-500",
      };
    case "COMPLETED":
      return {
        label: "Completed",
        bg: "bg-emerald-100",
        text: "text-emerald-800",
        dot: "bg-emerald-500",
      };
    case "FAILED":
      return {
        label: "Failed",
        bg: "bg-red-100",
        text: "text-red-800",
        dot: "bg-red-500",
      };
    case "PAUSED":
      return {
        label: "Paused",
        bg: "bg-stone-100",
        text: "text-stone-800",
        dot: "bg-stone-500",
      };
    default:
      return {
        label: state || "Active",
        bg: "bg-fog",
        text: "text-steel",
        dot: "bg-steel",
      };
  }
}
