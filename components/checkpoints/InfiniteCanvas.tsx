"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/Badge";
import { getDisplayName } from "@/lib/userColor";
import { formatDateTime } from "@/lib/format";
import { extractPlainTextFromTiptap, renderTiptapJsonToReact, TiptapEditor } from "@/components/mentions/TiptapEditor";
import type { CheckpointItem, CheckpointViewer } from "@/components/CheckpointsList";
import { markPanelSeen } from "@/lib/workspaceUnread";

// ── Types ────────────────────────────────────────────────────────────────────
type CanvasNode = CheckpointItem & {
  canvasX: number;
  canvasY: number;
  colorKey: "yellow" | "mint" | "lilac" | "peach" | "blue" | "white";
  isCentral?: boolean;
};

type Tool = "select" | "hand";

// ── Helpers ──────────────────────────────────────────────────────────────────
const NOTE_COLORS: Record<CanvasNode["colorKey"], { bg: string; border: string; headerBorder: string; pill: string; pillText: string }> = {
  yellow: { bg: "bg-[#fefce8]", border: "border-amber-300/80", headerBorder: "border-amber-200/60", pill: "bg-amber-200/60", pillText: "text-amber-900" },
  mint: { bg: "bg-[#f0fdf4]", border: "border-[#bbf7d0]", headerBorder: "border-emerald-100", pill: "bg-emerald-100/70", pillText: "text-emerald-800" },
  lilac: { bg: "bg-[#faf5ff]", border: "border-[#e9d5ff]", headerBorder: "border-purple-100", pill: "bg-purple-100", pillText: "text-purple-900" },
  peach: { bg: "bg-[#fff7ed]", border: "border-[#fed7aa]", headerBorder: "border-orange-100", pill: "bg-orange-100", pillText: "text-orange-900" },
  blue: { bg: "bg-[#f0f9ff]", border: "border-[#bae6fd]", headerBorder: "border-sky-100", pill: "bg-sky-100", pillText: "text-sky-900" },
  white: { bg: "bg-white", border: "border-zinc-300", headerBorder: "border-zinc-200", pill: "bg-zinc-100", pillText: "text-zinc-700" },
};

const MINIMAP_DOT: Record<CanvasNode["colorKey"], string> = {
  yellow: "#eab308",
  mint: "#10b981",
  lilac: "#a855f7",
  peach: "#f97316",
  blue: "#0ea5e9",
  white: "#a1a1aa",
};

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickColor(note: string, isAdminCentral?: boolean): CanvasNode["colorKey"] {
  if (isAdminCentral) return "yellow";
  const n = note.toLowerCase();
  if (n.includes("performance") || n.includes("redis") || n.includes("cache") || n.includes("vectors")) return "mint";
  if (n.includes("stitch") || n.includes("polish") || n.includes("design") || n.includes("diff")) return "lilac";
  if (n.includes("bug") || n.includes("safari") || n.includes("loading")) return "peach";
  if (n.includes("release") || n.includes("landing") || n.includes("smoother")) return "yellow";
  const h = hashString(note) % 5;
  return (["mint", "lilac", "peach", "blue", "yellow"] as const)[h]!;
}

function pillLabelFor(node: CanvasNode): string {
  if (node.isCentral) return "OFFICIAL CHECKPOINT";
  const n = node.note.toLowerCase();
  if (n.includes("performance") || n.includes("redis")) return "⚡ Performance Idea";
  if (n.includes("stitch") || n.includes("diff")) return "✦ Stitch UI Polish";
  if (n.includes("bug") || n.includes("safari")) return "🐞 Bug Resolved";
  if (n.includes("release")) return "OFFICIAL CHECKPOINT";
  return "Checkpoint";
}

// Deterministic initial layout — spreads nodes in a organic cluster like the screenshot (not a boring grid)
// Shifted right by ~80px so leftmost notes never sit under the floating toolbar or get clipped by overflow-hidden
function initialPosition(index: number, total: number): { x: number; y: number } {
  const presets: Array<{ x: number; y: number }> = [
    { x: 640, y: 270 }, // central
    { x: 250, y: 210 }, // mint — was 170, now 250 to clear toolbar
    { x: 230, y: 470 }, // lilac — was 150, now 230
    { x: 640, y: 520 }, // peach
    { x: 980, y: 300 }, // draft area
    { x: 460, y: 380 },
    { x: 900, y: 480 },
    { x: 380, y: 680 },
    { x: 780, y: 620 },
    { x: 1100, y: 520 },
  ];
  if (index < presets.length) return presets[index]!;
  // Spiral out for overflow
  const angle = (index * 137.5 * Math.PI) / 180;
  const radius = 320 + (index - presets.length) * 48;
  return { x: 640 + Math.cos(angle) * radius, y: 400 + Math.sin(angle) * radius };
}

const EXAMPLE_NOTES = [
  "made landingpage of vaayu smoother",
  "updates design theme in mobile app",
  "fixed loading state bug",
  "added checkpoints section for team progress",
];

// ── Component ────────────────────────────────────────────────────────────────
export function InfiniteCanvas({
  initialItems,
  currentUser,
  notice,
}: {
  initialItems: CheckpointItem[];
  currentUser: CheckpointViewer;
  notice?: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<CheckpointItem[]>(initialItems);
  useEffect(() => setItems(initialItems), [initialItems]);
  useEffect(() => {
    markPanelSeen("checkpoints");
  }, []);

  // Canvas viewport — centered so the central cluster is fully visible on all screen sizes (no left-edge clipping)
  const [pan, setPan] = useState({ x: -40, y: -20 });
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Live mirrors so native (non-React) listeners always see fresh values
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panMirror = useRef(pan);
  panMirror.current = pan;
  // Active gesture — window-level move/up listeners drive these so dragging
  // never breaks (no pointer-capture retargeting issues, no stale closures)
  const gestureRef = useRef<
    | null
    | { mode: "pan"; startX: number; startY: number }
    | { mode: "drag"; id: string; dx: number; dy: number; rectLeft: number; rectTop: number; panX: number; panY: number; zoom: number }
  >(null);

  // Selection + editing
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [editKey, setEditKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  // Latest editing id for the drag guard (skip drag while editing a note)
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  // Create draft
  const [createDraft, setCreateDraft] = useState<{ text: string; json: unknown } | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);

  // Draggable node positions — persisted to localStorage per id
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vaayu:canvas:positions");
      if (raw) setPositions(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("vaayu:canvas:positions", JSON.stringify(positions));
    } catch {}
  }, [positions]);

  const nodes: CanvasNode[] = useMemo(() => {
    return items.map((item, idx) => {
      const isCentral = idx === 0 && item.userRole === "admin";
      const pos = positions[item.id] ?? initialPosition(idx, items.length);
      return {
        ...item,
        canvasX: pos.x,
        canvasY: pos.y,
        colorKey: pickColor(item.note, isCentral),
        isCentral,
      };
    });
  }, [items, positions]);

  const filteredNodes = useMemo(() => {
    if (!search.trim()) return nodes;
    const q = search.toLowerCase();
    return nodes.filter((n) => n.note.toLowerCase().includes(q) || n.displayName?.toLowerCase().includes(q) || n.userEmail.toLowerCase().includes(q));
  }, [nodes, search]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? nodes[0] ?? null, [nodes, selectedId]);

  // Collaborators — unique authors
  const collaborators = useMemo(() => {
    const map = new Map<string, { id: string; email: string; displayName?: string | null; avatarDriveId?: string | null; role: string }>();
    for (const it of items) {
      if (!map.has(it.userId)) map.set(it.userId, { id: it.userId, email: it.userEmail, displayName: it.displayName, avatarDriveId: it.avatarDriveId, role: it.userRole });
    }
    return Array.from(map.values()).slice(0, 7);
  }, [items]);

  function canModerate(item: CheckpointItem) {
    return item.userId === currentUser.id || currentUser.role === "admin";
  }

  // ── API wiring ──────────────────────────────────────────────────────────
  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = createDraft?.text?.trim() ?? "";
    if (!trimmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed, contentJson: createDraft?.json ? JSON.stringify(createDraft.json) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkpoint.");
      setItems((prev) => [data.checkpoint, ...prev]);
      setCreateDraft(null);
      setCreateKey((k) => k + 1);
      setSelectedId(data.checkpoint.id);
      // place new node near center
      setPositions((p) => ({ ...p, [data.checkpoint.id]: { x: 640 + (Math.random() * 120 - 60), y: 320 + (Math.random() * 80 - 40) } }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdate(node: CanvasNode) {
    const trimmed = editDraft?.text?.trim() ?? "";
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/checkpoints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: node.id, note: trimmed, contentJson: editDraft?.json ? JSON.stringify(editDraft.json) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update checkpoint.");
      setItems((prev) => prev.map((e) => (e.id === node.id ? data.checkpoint : e)));
      setEditingId(null);
      setEditDraft(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(node: CanvasNode) {
    if (!window.confirm("Delete this checkpoint? It will be removed from the team timeline (kept as deleted history in the sheet).")) return;
    setError(null);
    try {
      const res = await fetch("/api/checkpoints", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: node.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || "Failed to delete checkpoint.");
      setItems((prev) => prev.filter((e) => e.id !== node.id));
      setPositions((p) => {
        const n = { ...p };
        delete n[node.id];
        return n;
      });
      if (selectedId === node.id) setSelectedId(items.find((i) => i.id !== node.id)?.id ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // ── Canvas interactions ───────────────────────────────────────────────
  const canvasOrigin = useCallback(() => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0, width: r?.width ?? 1, height: r?.height ?? 1 };
  }, []);

  const clampZoom = (z: number) => Math.min(2, Math.max(0.35, z));

  // Zoom keeping the point under the cursor stationary
  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, nextZoom: number) => {
      const { left, top } = canvasOrigin();
      const z0 = zoomRef.current;
      const z1 = clampZoom(nextZoom);
      if (z1 === z0) return;
      const wx = (clientX - left - panMirror.current.x) / z0;
      const wy = (clientY - top - panMirror.current.y) / z0;
      const p = { x: clientX - left - wx * z1, y: clientY - top - wy * z1 };
      panMirror.current = p;
      zoomRef.current = z1;
      setPan(p);
      setZoom(z1);
    },
    [canvasOrigin]
  );

  const centerOnWorld = useCallback(
    (wx: number, wy: number, targetZoom?: number) => {
      const { width, height } = canvasOrigin();
      const z1 = targetZoom === undefined ? zoomRef.current : clampZoom(targetZoom);
      zoomRef.current = z1;
      setZoom(z1);
      const p = { x: width / 2 - wx * z1, y: height / 2 - wy * z1 };
      panMirror.current = p;
      setPan(p);
    },
    [canvasOrigin]
  );

  const focusDraft = useCallback(() => {
    // Draft card lives at world (1110, 300), ~340px wide
    centerOnWorld(1110 + 170, 300 + 110);
    window.setTimeout(() => document.getElementById("draft-textarea")?.focus(), 60);
  }, [centerOnWorld]);

  // Native non-passive wheel listener: React's onWheel is passive at the root,
  // so preventDefault() there is ignored and ctrl+scroll zooms the whole page.
  // This captures ctrl/cmd+wheel first and zooms ONLY the canvas mesh.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onNativeWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      zoomAtPoint(e.clientX, e.clientY, zoomRef.current * Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", onNativeWheel);
  }, [zoomAtPoint]);

  // Window-level move/up: drives pan + note drag regardless of which element
  // is under the pointer, so dragging notes never drops or jumps.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.mode === "pan") {
        const p = { x: e.clientX - g.startX, y: e.clientY - g.startY };
        panMirror.current = p;
        setPan(p);
      } else {
        const wx = (e.clientX - g.rectLeft - g.panX) / g.zoom;
        const wy = (e.clientY - g.rectTop - g.panY) / g.zoom;
        setPositions((p) => ({ ...p, [g.id]: { x: wx - g.dx, y: wy - g.dy } }));
      }
    };
    const onUp = () => {
      gestureRef.current = null;
      setIsPanning(false);
      setDraggingId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return;
      if ((e.target as HTMLElement).closest("[data-node]") || (e.target as HTMLElement).closest("[data-ui]")) return;
      const { left, top } = canvasOrigin();
      // Click empty canvas -> clear selection; any drag pans (hand tool or not)
      if (e.button === 0 && tool === "select" && !e.altKey) setSelectedId(null);
      gestureRef.current = { mode: "pan", startX: e.clientX - left - panMirror.current.x, startY: e.clientY - top - panMirror.current.y };
      setIsPanning(true);
    },
    [canvasOrigin, tool]
  );

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, node: CanvasNode) => {
      if (e.button !== 0) return;
      // Hand tool: let the event bubble so the canvas pans from anywhere
      if (tool !== "select") return;
      e.stopPropagation();
      setSelectedId(node.id);
      // Never hijack text editing / form controls / buttons inside a note
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable], button, a")) return;
      if (editingIdRef.current === node.id) return;
      const { left, top } = canvasOrigin();
      const z = zoomRef.current;
      const wx = (e.clientX - left - panMirror.current.x) / z;
      const wy = (e.clientY - top - panMirror.current.y) / z;
      gestureRef.current = {
        mode: "drag",
        id: node.id,
        dx: wx - node.canvasX,
        dy: wy - node.canvasY,
        rectLeft: left,
        rectTop: top,
        panX: panMirror.current.x,
        panY: panMirror.current.y,
        zoom: z,
      };
      setDraggingId(node.id);
    },
    [canvasOrigin, tool]
  );

  // Keyboard: "/" focuses search, V/H switch tools, Esc cancels editing/drag
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("canvas-search")?.focus();
      }
      if (!typing && (e.key === "v" || e.key === "V")) setTool("select");
      if (!typing && (e.key === "h" || e.key === "H")) setTool("hand");
      if (e.key === "Escape") {
        setEditingId(null);
        gestureRef.current = null;
        setDraggingId(null);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Connectors: chain nodes by recency + extra star from central
  const connectors = useMemo(() => {
    if (filteredNodes.length < 2) return [];
    const sorted = [...filteredNodes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const central = sorted.find((n) => n.isCentral) ?? sorted[0]!;
    const lines: Array<{ from: CanvasNode; to: CanvasNode; dashed?: boolean; color: string; marker: string }> = [];
    // Sequential chain (muted)
    for (let i = 1; i < sorted.length; i++) {
      lines.push({ from: sorted[i]!, to: sorted[i - 1]!, dashed: true, color: "#52525b", marker: "arrow-charcoal" });
    }
    // Star from central to first 3 others (purple for design nodes)
    const others = sorted.filter((n) => n.id !== central.id).slice(0, 3);
    for (const o of others) {
      const isPurple = o.colorKey === "lilac";
      lines.push({ from: central, to: o, dashed: false, color: isPurple ? "#9333ea" : "#52525b", marker: isPurple ? "arrow-purple" : "arrow-charcoal" });
    }
    return lines;
  }, [filteredNodes]);

  const handleMentionClick = (type: string, id: string) => {
    if (type === "person") router.push("/admin");
    else if (type === "project") router.push("/projects");
    else if (type === "file" || type === "folder") router.push(`/files?highlight=${encodeURIComponent(id)}`);
    else if (type === "checkpoint") {
      const target = nodes.find((n) => n.id === id);
      if (target) {
        setSelectedId(target.id);
        setPan({ x: -target.canvasX + 600, y: -target.canvasY + 300 });
      }
    }
  };

  return (
    <div className="relative h-[calc(100vh-57px)] w-full overflow-hidden bg-[#fcfcfc] select-none">
      {/* Canvas dot grid — infinite, follows pan/zoom so wires never appear to float over static dots */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "#fcfcfc",
          backgroundImage: "radial-gradient(#d4d4d8 1.1px, transparent 1.1px)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      {/* ── Top Navigation Header ── */}
      <header className="absolute top-0 left-0 right-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-[#e4e4e7] px-5 flex items-center justify-between" data-ui>
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center text-white font-semibold text-xs tracking-wider shadow-sm">V</div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 tracking-wider uppercase">
                <span>TEAM TIMELINE</span>
                <span>/</span>
                <span className="text-zinc-600">Canvas Mode</span>
              </div>
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900 flex items-center gap-2">
                Vaayu Core Workspace
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" /> live
                </span>
              </h1>
            </div>
          </div>
          <div className="h-5 w-[1px] bg-zinc-200 ml-2 hidden sm:block" />
          <span className="hidden md:inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200/80">
            Infinite Graph Canvas
          </span>
        </div>

        <div className="relative hidden lg:block w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </div>
          <input
            id="canvas-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search checkpoints, notes, or tags... (Press '/' to focus)"
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-zinc-50/70 border border-zinc-200 rounded-lg text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:bg-white transition-all"
          />
          <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
            <kbd className="text-[10px] font-mono text-zinc-400 border border-zinc-200 rounded px-1.5 bg-white">/</kbd>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center -space-x-2 mr-2">
            {collaborators.slice(0, 3).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSearch((s) => (s === u.email ? "" : u.email))}
                className="relative cursor-pointer rounded-full"
                title={`${getDisplayName(u.displayName, u.email)} (${u.role}) — click to filter`}
              >
                <UserAvatar displayName={u.displayName} email={u.email} userId={u.id} avatarDriveId={u.avatarDriveId} size={28} />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
              </button>
            ))}
            {collaborators.length > 3 && (
              <div className="w-7 h-7 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center text-[10px] font-medium ring-2 ring-white border border-zinc-200">
                +{collaborators.length - 3}
              </div>
            )}
          </div>
          <button
            onClick={focusDraft}
            className="hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition shadow-sm"
            title="Pan to the note composer"
          >
            <svg className="w-3.5 h-3.5 mr-1.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            New Sticky
          </button>
          <button
            onClick={focusDraft}
            className="inline-flex items-center px-3.5 py-1.5 text-xs font-medium text-white bg-[#52525b] hover:bg-[#3f3f46] rounded-lg shadow-sm transition"
            title="Pan to the note composer"
          >
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            Post Checkpoint
          </button>
        </div>
      </header>

      {/* ── Left Floating Toolbar: canvas tools only ── */}
      <aside className="absolute left-6 top-24 z-20 flex flex-col bg-white border border-[#e4e4e7] rounded-xl shadow-[0_12px_32px_-4px_rgba(0,0,0,0.08),0_4px_12px_-2px_rgba(0,0,0,0.04)] p-1.5 space-y-1" data-ui>
        {[
          { id: "select", icon: "M3 3l7 18 3-7 7-3L3 3z", title: "Select / move notes (V)" },
          { id: "hand", icon: "M18 11V6a2 2 0 00-4 0v5m-4 0V4a2 2 0 00-4 0v9m-4 0V8a2 2 0 00-4 0v10a6 6 0 0012 0v-4", title: "Hand / pan canvas (H)" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id as Tool)}
            className={`p-2 rounded-lg transition flex items-center justify-center ${tool === t.id ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}`}
            title={t.title}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d={t.icon} />
            </svg>
          </button>
        ))}
      </aside>

      {/* ── Infinite Canvas Workspace ── */}
      <main
        ref={canvasRef}
        onPointerDown={onCanvasPointerDown}
        className={`absolute inset-0 pt-16 overflow-hidden ${tool === "hand" || isPanning ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
        >
          {/* SVG Connector Layer — infinite: covers 8000×6000 world so wires never clip */}
          <svg className="absolute left-0 top-0 pointer-events-none z-0" style={{ width: 8000, height: 6000 }} xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arrow-charcoal" markerWidth="6" markerHeight="6" orient="auto" refX="7" refY="5" viewBox="0 0 10 10">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#52525b" />
              </marker>
              <marker id="arrow-purple" markerWidth="6" markerHeight="6" orient="auto" refX="7" refY="5" viewBox="0 0 10 10">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#9333ea" />
              </marker>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" floodColor="#000" floodOpacity="0.06" stdDeviation="2" />
              </filter>
            </defs>
            {connectors.map((c, i) => {
              const fhw = c.from.isCentral ? 165 : 135;
              const thw = c.to.isCentral ? 165 : 135;
              // Anchor at the visual edge-center of each sticky (more natural than top-center)
              const fx = c.from.canvasX + fhw;
              const fy = c.from.canvasY + 80;
              const tx = c.to.canvasX + thw;
              const ty = c.to.canvasY + 40;
              const dx = Math.abs(tx - fx);
              const mx = (fx + tx) / 2;
              // Softer, longer curves for far nodes; tighter for close nodes — avoids stiff wires
              const offset = Math.min(180, Math.max(40, dx * 0.35));
              const c1x = fx + (tx > fx ? offset : -offset);
              const c2x = tx + (tx > fx ? -offset : offset);
              return (
                <path
                  key={i}
                  d={`M ${fx} ${fy} C ${c1x} ${fy}, ${c2x} ${ty}, ${tx} ${ty}`}
                  fill="none"
                  filter={c.dashed ? "url(#glow)" : undefined}
                  markerEnd={`url(#${c.marker})`}
                  stroke={c.color}
                  strokeWidth={c.dashed ? 1.5 : 2}
                  strokeDasharray={c.dashed ? "6,4" : undefined}
                  strokeOpacity={c.color === "#9333ea" ? 0.7 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
            {/* Anchor dots */}
            {connectors.slice(0, 4).map((c, i) => (
              <g key={`dot-${i}`}>
                <circle cx={c.to.canvasX + (c.to.isCentral ? 165 : 135)} cy={c.to.canvasY + 40} r="3.5" fill={i === 0 ? "#10b981" : i === 2 ? "#a855f7" : i === 3 ? "#71717a" : "#52525b"} stroke="#ffffff" strokeWidth="1.5" />
              </g>
            ))}
          </svg>

          {/* Nodes — infinite world 8000×6000, panned via transform on parent */}
          <div className="relative" style={{ width: 8000, height: 6000, paddingLeft: 80, paddingTop: 24 }}>
            {filteredNodes.map((node) => {
              const isSelected = selectedId === node.id;
              const isEditing = editingId === node.id;
              const colors = NOTE_COLORS[node.colorKey];
              const isCentral = node.isCentral;
              const primary = getDisplayName(node.displayName, node.userEmail);
              return (
                <article
                  key={node.id}
                  data-node
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onClick={() => setSelectedId(node.id)}
                  className={`absolute canvas-node group select-text ${colors.bg} border rounded-xl p-4 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.03)] hover:shadow-[0_20px_30px_-10px_rgba(0,0,0,0.08),0_10px_15px_-5px_rgba(0,0,0,0.04)] ${draggingId === node.id ? "cursor-grabbing z-20" : "cursor-pointer"} ${isCentral ? "border-2 rounded-2xl p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] ring-4 ring-amber-100/60 w-[330px]" : "w-[270px]"} ${isSelected ? "ring-2 ring-zinc-900/10 z-10" : ""}`}
                  style={{ left: node.canvasX, top: node.canvasY, transition: draggingId === node.id ? "none" : undefined }}
                >
                  <div className={`washi-tape absolute -top-2.5 left-1/2 -translate-x-1/2 h-4 rounded-sm border border-zinc-200/50 backdrop-blur-[2px] ${isCentral ? "w-24 h-5 -top-3 border-amber-200/80" : "w-16"} rotate-1`} style={{ background: "rgba(255,255,255,0.7)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }} />

                  <div className={`flex items-center justify-between pb-2 border-b ${colors.headerBorder}`}>
                    <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${colors.pill} ${colors.pillText}`}>{pillLabelFor(node)}</span>
                    <span className="text-zinc-500 font-mono text-[10px]">{new Date(node.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-3">
                      <TiptapEditor
                        key={editKey}
                        placeholder="Edit checkpoint… @ to mention"
                        initialContentJson={node.contentJson ?? null}
                        initialText={!node.contentJson ? node.note : undefined}
                        onChange={setEditDraft}
                        onSubmit={(c) => {
                          setEditDraft(c);
                          setTimeout(() => handleUpdate(node), 0);
                        }}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft(null);
                          }}
                          disabled={isSaving}
                          className="px-3 py-1.5 text-xs border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdate(node)}
                          disabled={isSaving || !editDraft?.text?.trim()}
                          className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isCentral ? (
                        <div className="mt-3.5 space-y-2">
                          <div className="inline-block px-2 py-0.5 rounded bg-amber-200/60 text-amber-900 text-[10px] font-semibold tracking-wide">OFFICIAL CHECKPOINT</div>
                          <div className="text-xs font-semibold text-zinc-900 leading-snug">
                            {(() => {
                              try {
                                if (node.contentJson) {
                                  const j = JSON.parse(node.contentJson);
                                  const rendered = renderTiptapJsonToReact(j, handleMentionClick);
                                  if (rendered) return <div className="text-xs font-semibold">{rendered}</div>;
                                }
                              } catch {}
                              return <span>{node.note.slice(0, 80)}</span>;
                            })()}
                          </div>
                          <p className="text-xs text-zinc-600 leading-relaxed line-clamp-3">{node.note.slice(0, 160)}</p>
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white text-zinc-700 border border-amber-200">#release</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white text-zinc-700 border border-amber-200">#frontend</span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-xs leading-relaxed text-zinc-800">
                          {(() => {
                            try {
                              if (node.contentJson) {
                                const j = JSON.parse(node.contentJson);
                                const rendered = renderTiptapJsonToReact(j, handleMentionClick);
                                if (rendered) return rendered;
                              }
                            } catch {}
                            return <span>{node.note}</span>;
                          })()}
                        </div>
                      )}
                    </>
                  )}

                  <div className={`mt-4 pt-2.5 flex items-center justify-between gap-2 text-[11px] border-t ${colors.headerBorder}`}>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <UserAvatar displayName={node.displayName} email={node.userEmail} userId={node.userId} size={20} />
                      <span className="truncate text-zinc-600 font-medium text-[10px]">{getDisplayName(node.displayName, node.userEmail)}</span>
                    </div>
                    <span className="shrink-0 truncate text-[10px] font-mono text-zinc-400 max-w-[90px] text-right" title={node.userEmail}>{isCentral ? node.userEmail : node.userEmail.split("@")[0]}</span>
                  </div>

                  {isCentral && !isEditing && (
                    <div className="mt-4 pt-3 flex items-center justify-between border-t border-amber-200/60 text-xs">
                      <span className="flex items-center gap-1 text-zinc-400 text-[11px]">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                        {connectors.length} connected
                      </span>
                      <span className="flex items-center gap-1.5">
                        {canModerate(node) && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(node.id);
                                const parsed = node.contentJson ? (() => { try { return JSON.parse(node.contentJson!); } catch { return null; } })() : null;
                                if (parsed) {
                                  try {
                                    const t = extractPlainTextFromTiptap(parsed) || node.note;
                                    setEditDraft({ text: t, json: parsed });
                                  } catch {
                                    setEditDraft({ text: node.note, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: node.note }] }] } });
                                  }
                                } else setEditDraft({ text: node.note, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: node.note }] }] } });
                                setEditKey((k) => k + 1);
                              }}
                              className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-zinc-50 border border-zinc-200 rounded"
                            >
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(node);
                              }}
                              className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-red-50 text-zinc-500 hover:text-red-600 border border-zinc-200 rounded"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {!isCentral && !isEditing && canModerate(node) && (
                    <div className="mt-3 flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(node.id);
                          const parsed = node.contentJson ? (() => { try { return JSON.parse(node.contentJson!); } catch { return null; } })() : null;
                          if (parsed) {
                            const t = extractPlainTextFromTiptap(parsed) || node.note;
                            setEditDraft({ text: t, json: parsed });
                          } else setEditDraft({ text: node.note, json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: node.note }] }] } });
                          setEditKey((k) => k + 1);
                        }}
                        className="text-[11px] px-2 py-1 rounded border border-zinc-200 hover:border-zinc-300 bg-white/70"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(node);
                        }}
                        className="text-[11px] px-2 py-1 rounded border border-zinc-200 hover:border-red-300 hover:text-red-600 bg-white/70"
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Central header avatar row */}
                  {isCentral && (
                    <div className="absolute -top-1 left-4 right-4 hidden">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <UserAvatar displayName={node.displayName} email={node.userEmail} size={24} />
                          <span className="text-xs font-bold">{getDisplayName(node.displayName, node.userEmail)}</span>
                          <Badge tone="phase">ADMIN</Badge>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400">{formatDateTime(node.createdAt)}</span>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {/* Draft Node — always at far right like HTML */}
            <article
              id="draft-node"
              className="absolute w-[340px] bg-white border-2 border-dashed border-zinc-300 rounded-2xl p-5 shadow-sm hover:border-zinc-400 transition"
              style={{ left: 1110, top: 300 }}
              data-ui
            >
              <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-zinc-300" /> Draft Checkpoint Note
                </span>
                <span className="text-[10px] font-mono">Type + Enter ↵ to post</span>
              </div>
              <div className="mt-3">
                <TiptapEditor
                  key={createKey}
                  placeholder="e.g. made landingpage of vaayu smoother... @ to mention people, projects, files"
                  onChange={setCreateDraft}
                  onSubmit={(c) => {
                    setCreateDraft(c);
                    setTimeout(() => handleCreate(), 0);
                  }}
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">QUICK SUGGESTIONS</div>
                <div className="flex flex-wrap gap-1">
                  {EXAMPLE_NOTES.slice(0, 3).map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: ex }] }] };
                        setCreateDraft({ text: ex, json });
                        setTimeout(() => handleCreate(), 50);
                      }}
                      className="text-[10px] text-zinc-600 bg-zinc-100 hover:bg-zinc-200 px-2 py-0.5 rounded transition"
                    >
                      &quot;{ex}&quot;
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => { setCreateDraft(null); setCreateKey((k) => k + 1); }} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800">
                  Clear
                </button>
                <button
                  onClick={() => handleCreate()}
                  disabled={isSubmitting || !createDraft?.text?.trim()}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#52525b] hover:bg-[#3f3f46] rounded-lg transition shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? "Posting..." : "Post Checkpoint"}
                </button>
              </div>
            </article>
          </div>
        </div>
      </main>

      {/* ── Right Collapsible Context Inspector ── */}
      <aside className={`absolute right-5 top-20 bottom-6 w-80 bg-white/95 backdrop-blur-sm border border-[#e4e4e7] rounded-2xl shadow-[0_12px_32px_-4px_rgba(0,0,0,0.08),0_4px_12px_-2px_rgba(0,0,0,0.04)] flex-col z-20 overflow-hidden ${showInspector ? "hidden lg:flex" : "hidden"}`} data-ui>
        <div className="p-4 border-b border-[#e4e4e7] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <h3 className="text-xs font-bold text-zinc-800 uppercase tracking-wider">Node Inspector</h3>
          </div>
          <button onClick={() => setShowInspector(false)} className="text-zinc-400 hover:text-zinc-600 p-1 rounded">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-xs">
          {selectedNode ? (
            <>
              <div>
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Selected Target</div>
                <div className="p-2.5 bg-zinc-50 rounded-lg border border-zinc-200/70 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-900 truncate">{selectedNode.note.slice(0, 48)}</div>
                    <div className="text-[11px] text-zinc-500 font-mono mt-0.5">ID: #{selectedNode.id.slice(0, 6)}</div>
                  </div>
                  <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded shrink-0">{selectedNode.isCentral ? "Checkpoint" : "Note"}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Connected Nodes ({connectors.filter((c) => c.from.id === selectedNode.id || c.to.id === selectedNode.id).length})</div>
                <div className="space-y-1.5">
                  {connectors
                    .filter((c) => c.from.id === selectedNode.id || c.to.id === selectedNode.id)
                    .slice(0, 4)
                    .map((c, i) => {
                      const other = c.from.id === selectedNode.id ? c.to : c.from;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            setSelectedId(other.id);
                            centerOnWorld(other.canvasX + (other.isCentral ? 165 : 135), other.canvasY + 80);
                          }}
                          className="flex items-center justify-between p-2 rounded bg-white border border-zinc-200 hover:border-zinc-300 cursor-pointer"
                          title="Jump to this note"
                        >
                          <span className="text-zinc-700 truncate font-medium text-xs">{other.note.slice(0, 28)}</span>
                          <span className="text-[10px] text-zinc-400">{c.from.id === selectedNode.id ? "Outbound" : "Inbound"}</span>
                        </div>
                      );
                    })}
                  {connectors.filter((c) => c.from.id === selectedNode.id || c.to.id === selectedNode.id).length === 0 && (
                    <p className="text-zinc-500 text-xs">No connections yet.</p>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Author & Time</div>
                <div className="flex items-center gap-2 p-2.5 bg-zinc-50 rounded-lg border border-zinc-200">
                  <UserAvatar displayName={selectedNode.displayName} email={selectedNode.userEmail} userId={selectedNode.userId} size={28} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900">{getDisplayName(selectedNode.displayName, selectedNode.userEmail)}</div>
                    <div className="text-[11px] text-zinc-500 font-mono">{selectedNode.userEmail}</div>
                  </div>
                  <Badge tone={selectedNode.userRole === "admin" ? "phase" : "live"}>{selectedNode.userRole}</Badge>
                </div>
                <p className="mt-2 font-mono text-[11px] text-zinc-500">{formatDateTime(selectedNode.createdAt)}</p>
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-zinc-700">No node selected</p>
              <p className="mt-1 text-xs text-zinc-500">Click a sticky note on the canvas to inspect it.</p>
            </div>
          )}
          {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{notice}</div>}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        </div>
        <div className="p-4 border-t border-[#e4e4e7] bg-zinc-50/60">
          {selectedNode && canModerate(selectedNode) ? (
            <button
              onClick={() => handleDelete(selectedNode)}
              className="w-full py-2 px-3 text-xs font-medium text-white bg-[#52525b] hover:bg-[#3f3f46] rounded-lg transition shadow-sm flex items-center justify-center gap-2"
            >
              <span>Delete Checkpoint</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          ) : (
            <p className="text-center text-[11px] text-zinc-400">Only the author or an admin can delete this note.</p>
          )}
        </div>
      </aside>

      {/* Inspector toggle when hidden */}
      {!showInspector && (
        <button onClick={() => setShowInspector(true)} className="absolute right-5 top-20 z-20 bg-white border border-[#e4e4e7] rounded-xl shadow p-2" data-ui title="Open inspector">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </button>
      )}

      {/* ── Bottom Canvas Controls ── */}
      <footer className="absolute bottom-6 left-6 z-20 flex items-center gap-3" data-ui>
        <div className="flex items-center bg-white border border-[#e4e4e7] rounded-xl shadow-[0_12px_32px_-4px_rgba(0,0,0,0.08),0_4px_12px_-2px_rgba(0,0,0,0.04)] px-2 py-1.5 space-x-2 text-xs font-medium text-zinc-700">
          <button onClick={() => { const o = canvasOrigin(); zoomAtPoint(o.left + o.width / 2, o.top + o.height / 2, zoomRef.current - 0.15); }} className="p-1 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900" title="Zoom Out">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M20 12H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
          <span className="w-12 text-center font-mono text-[11px] font-semibold text-zinc-800 select-none">{Math.round(zoom * 100)}%</span>
          <button onClick={() => { const o = canvasOrigin(); zoomAtPoint(o.left + o.width / 2, o.top + o.height / 2, zoomRef.current + 0.15); }} className="p-1 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900" title="Zoom In">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
          <div className="h-4 w-[1px] bg-zinc-200" />
          <button onClick={() => { setPan({ x: -120, y: -40 }); setZoom(1); }} className="p-1 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800" title="Reset View / Recenter">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>
        <div className="hidden sm:flex items-center bg-white border border-[#e4e4e7] rounded-xl shadow-[0_12px_32px_-4px_rgba(0,0,0,0.08)] p-1 text-xs">
          <div
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              centerOnWorld(((e.clientX - r.left) / r.width) * 2400, ((e.clientY - r.top) / r.height) * 1600);
            }}
            className="w-20 h-11 bg-zinc-50 rounded border border-zinc-200 relative overflow-hidden cursor-pointer"
            title="Click to jump"
          >
            {filteredNodes.map((n) => (
              <span
                key={n.id}
                className="absolute w-1.5 h-1.5 rounded-full pointer-events-none"
                style={{ left: `${(n.canvasX / 2400) * 100}%`, top: `${(n.canvasY / 1600) * 100}%`, background: MINIMAP_DOT[n.colorKey] }}
              />
            ))}
            {(() => {
              const o = canvasOrigin();
              return (
                <div
                  className="border border-zinc-900/60 rounded-[2px] pointer-events-none absolute"
                  style={{
                    left: `${(-pan.x / zoom / 2400) * 100}%`,
                    top: `${(-pan.y / zoom / 1600) * 100}%`,
                    width: `${(o.width / zoom / 2400) * 100}%`,
                    height: `${(o.height / zoom / 1600) * 100}%`,
                  }}
                />
              );
            })()}
          </div>
        </div>
      </footer>

      <style>{`
        .infinite-canvas-bg { background-color: #fcfcfc; background-image: radial-gradient(#d4d4d8 1.1px, transparent 1.1px); background-size: 24px 24px; }
        .canvas-node { transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease; }
        .canvas-node:hover { transform: translateY(-2px); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e4e4e7; border-radius: 4px; }
        .washi-tape { background: rgba(255,255,255,0.7); backdrop-filter: blur(2px); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
      `}</style>
    </div>
  );
}
