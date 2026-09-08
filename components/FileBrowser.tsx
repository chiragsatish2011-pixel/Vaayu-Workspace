"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatBytes } from "@/components/UploadProgressBar";
import { FolderIcon, BoxIcon, GridIcon, ListIcon, MusicIcon, PlayIcon, DocIcon, ImageIcon } from "@/components/icons";
import {
  collectFilesFromDrop,
  collectFilesFromInput,
  pickedBatchBytes,
  type PickedUploadFile,
} from "@/components/folderWalk";
import { useFolderUpload } from "@/components/useFolderUpload";
import { useUploads } from "@/components/UploadManager";

/* ── Types ────────────────────────────────────────────────────────── */
export interface BrowseFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
  isFolder: boolean;
  relativePath: string;
}

interface BrowseResponse {
  root: BrowseFile;
  isFolder: boolean;
  totalBytes: number;
  fileCount: number;
  files: BrowseFile[];
}

// Tree node for folder structure
type TreeNode = {
  id: string; // for folders, Drive id; for files, Drive id
  name: string;
  relativePath: string;
  isFolder: boolean;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  iconLink?: string;
  children: Map<string, TreeNode>;
  file?: BrowseFile; // original file for leaf
  totalDescendantFiles?: number; // for folder download warning
};

/* ── Helpers ─────────────────────────────────────────────────────── */
function isImage(mime: string, name: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return true;
  const ext = name.toLowerCase().split(".").pop() || "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff"].includes(ext);
}

function isCodeText(mime: string, name: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m.includes("json") || m.includes("javascript") || m.includes("typescript") || m.includes("xml") || m.includes("yaml")) return true;
  const ext = name.toLowerCase().split(".").pop() || "";
  const codeExts = new Set([
    "js", "ts", "tsx", "jsx", "py", "json", "md", "html", "htm", "css", "scss", "less",
    "java", "c", "cpp", "h", "hpp", "go", "rs", "rb", "php", "sh", "yaml", "yml", "toml",
    "ini", "env", "txt", "log", "csv", "sql", "xml", "svg", "vue", "svelte", "astro",
  ]);
  return codeExts.has(ext);
}

function fileIconFor(mime: string, name: string): string {
  const m = mime.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() || "";
  if (m.includes("pdf")) return "📄";
  if (m.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "🎬";
  if (m.startsWith("audio/") || ["mp3", "wav", "ogg", "flac"].includes(ext)) return "🎵";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return "📦";
  if (m.includes("spreadsheet") || ["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (m.includes("presentation") || ["ppt", "pptx"].includes(ext)) return "📊";
  if (m.includes("document") || ["doc", "docx"].includes(ext)) return "📄";
  return "📄";
}

/* ── Build tree from flat list ─────────────────────────────────── */
function buildTree(files: BrowseFile[], rootName: string, rootId: string): TreeNode {
  const root: TreeNode = {
    id: rootId,
    name: rootName,
    relativePath: "",
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
    children: new Map(),
  };
  for (const f of files) {
    // Skip the root itself if present
    if (f.relativePath === "" || f.relativePath === rootName) continue;
    const parts = f.relativePath.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      if (!cur.children.has(part)) {
        const isFolderNode = !isLast ? true : f.isFolder;
        cur.children.set(part, {
          id: isLast ? f.id : `folder-${parts.slice(0, i + 1).join("/")}`,
          name: part,
          relativePath: parts.slice(0, i + 1).join("/"),
          isFolder: isFolderNode,
          mimeType: isLast ? f.mimeType : "application/vnd.google-apps.folder",
          size: isLast ? f.size : undefined,
          thumbnailLink: isLast ? f.thumbnailLink : undefined,
          iconLink: isLast ? f.iconLink : undefined,
          children: new Map(),
          file: isLast ? f : undefined,
        });
      }
      cur = cur.children.get(part)!;
      // If leaf file, ensure file ref is set
      if (isLast && f.isFolder === false) cur.file = f;
      if (isLast && f.isFolder) cur.file = f;
    }
  }
  return root;
}

function countDescendantFiles(node: TreeNode): number {
  if (!node.isFolder) return 1;
  let c = 0;
  for (const child of node.children.values()) {
    if (child.isFolder) c += countDescendantFiles(child);
    else c += 1;
  }
  return c;
}

function sumDescendantBytes(node: TreeNode): number {
  if (!node.isFolder) return Number(node.size || 0) || 0;
  let s = 0;
  for (const child of node.children.values()) s += sumDescendantBytes(child);
  return s;
}

/* ── Flatten visible nodes for virtualization ───────────────────── */
type FlatNode = { node: TreeNode; depth: number; isExpanded: boolean };

function flattenVisible(
  root: TreeNode,
  expanded: Set<string>,
  sortDir: "asc" | "desc" = "asc"
): FlatNode[] {
  const out: FlatNode[] = [];
  const dir = sortDir === "asc" ? 1 : -1;
  function walk(n: TreeNode, depth: number) {
    // Don't include root itself in list — its children are top level.
    // Folders always stay grouped first (Drive convention); sort applies
    // by name within each group.
    for (const child of Array.from(n.children.values()).sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return dir * a.name.localeCompare(b.name);
    })) {
      const isExp = expanded.has(child.relativePath);
      out.push({ node: child, depth, isExpanded: isExp });
      if (child.isFolder && isExp) walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

/* ── Preview cache (session) ────────────────────────────────────── */
const snippetCache = new Map<string, { snippet: string; truncated: boolean }>();
const thumbnailCache = new Map<string, string>(); // id -> thumbnailLink (already in metadata, but cache for future)

/** Max cards rendered per grid section before "Show more" (huge folders). */
const GRID_PAGE_SIZE = 500;

/** Media bucket driving grid tile fallbacks (thumbnailLink wins first). */
export type MediaKind = "image" | "video" | "audio" | "code" | "doc" | "other";

export function mediaKind(mimeType: string, name: string): MediaKind {
  if (isImage(mimeType, name)) return "image";
  const m = mimeType.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() || "";
  if (
    m.startsWith("video/") ||
    ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)
  )
    return "video";
  if (
    m.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)
  )
    return "audio";
  if (isCodeText(mimeType, name)) return "code";
  return "doc";
}

/**
 * Lazy code/text snippet for grid doc previews. Shares FileRow's session
 * cache + abort semantics so list and grid never double-fetch a file.
 */
export function useFileSnippet(
  mimeType: string,
  name: string,
  id: string,
  enabled: boolean
): { snippet: string | null; loading: boolean; error: string | null } {
  const [snippet, setSnippet] = useState<string | null>(
    () => snippetCache.get(id)?.snippet ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!enabled || !isCodeText(mimeType, name)) return;
    if (snippetCache.has(id)) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/drive/snippet?id=${encodeURIComponent(id)}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "No preview");
        return j as { snippet: string };
      })
      .then((j) => {
        if (cancelled) return;
        snippetCache.set(id, { snippet: j.snippet, truncated: false });
        setSnippet(j.snippet);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "No preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [enabled, mimeType, name, id]);
  return { snippet, loading, error };
}

/* ── Component ─────────────────────────────────────────────────────
 * General-purpose Drive folder browser. Originally built for per-project
 * folders; now also rooted at the team folder by the Files page — pass any
 * folder id as `projectDriveId` plus a display `projectName`. Delete moves
 * items to Drive trash (recoverable), never permanent-deletes.
 *
 * `manage` switches on the in-app file-manager actions (Files page only):
 * New Folder, Rename, and Move-to-dialog — all executed directly against
 * the Drive API with a fresh refetch after every mutation, so the UI can
 * never drift from Drive state. Projects stays a backup/archive surface
 * and never passes `manage`.
 */
export function FileBrowser({
  projectId,
  projectDriveId,
  projectName,
  emptyText,
  contextNoun = "project",
  refreshKey = 0,
  manage = false,
  defaultView = "list",
  onClose,
  onUploaded,
}: {
  projectId?: string;
  projectDriveId: string;
  projectName: string;
  /** Empty-state copy override (default mentions the context noun). */
  emptyText?: string;
  /** Human noun for copy ("project" | "folder"). */
  contextNoun?: string;
  /** Bump to refetch listing (e.g. after uploads land from elsewhere). */
  refreshKey?: number;
  /**
   * In-app file-manager actions (New Folder / Rename / Move). Files page
   * only — Projects never sets this, so manager UI can't leak there.
   */
  manage?: boolean;
  /** Initial view. Files page uses grid; Projects modal keeps list. */
  defaultView?: "grid" | "list";
  onClose?: () => void;
  /** Called after a successful upload so the parent can bump refreshKey (fresh fetch). */
  onUploaded?: () => void;
}) {
  void projectId;
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // In-app manager ops (manage only): one busy flag + dialog drafts.
  const [mutating, setMutating] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Guards Enter+blur double-submit of the same rename.
  const renameInflight = useRef<string | null>(null);
  const [moveNode, setMoveNode] = useState<TreeNode | null>(null);
  const [moveDestId, setMoveDestId] = useState<string | null>(null);
  // Grid view (reference layout): card grid with folder navigation.
  const [view, setView] = useState<"grid" | "list">(defaultView);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Path of folder names from the root to the grid's current folder.
  const [gridPath, setGridPath] = useState<string[]>([]);
  const [gridLimit, setGridLimit] = useState(GRID_PAGE_SIZE);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Drive-identical "+ New" + drag upload (manage only). No persistent
  // drop-zone card — drag works directly onto the list/grid area.
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { track } = useUploads();
  const { runFolderUpload } = useFolderUpload();
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  // Fetch browse data (extracted so delete/upload flows can refetch on demand)
  const load = useCallback(
    async (forceFresh?: boolean) => {
      setLoading(true);
      setError(null);
      try {
        // refreshKey > 0 or forceFresh means "something changed elsewhere"
        // (upload landed, trash completed) → fresh=1 bypasses the 30s server
        // listing cache so the next paint shows truth. Plain opens stay cached
        // and fast.
        const useFresh = Boolean(forceFresh) || refreshKey > 0;
        const url =
          `/api/drive/browse?id=${encodeURIComponent(projectDriveId)}` +
          (useFresh ? "&fresh=1" : "");
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "Could not load folder.");
        setData(j as BrowseResponse);
        // Default: expand first level only for large projects, or all for small
        // Requirement 3: collapsed default, only first level expanded for huge
        const tree = buildTree(
          (j as BrowseResponse).files,
          (j as BrowseResponse).root.name,
          (j as BrowseResponse).root.id
        );
        const firstLevel = Array.from(tree.children.values())
          .filter((n) => n.isFolder)
          .slice(0, 3)
          .map((n) => n.relativePath);
        // If small project (<100 files), expand first level; if huge, keep collapsed
        if ((j as BrowseResponse).fileCount < 100) {
          setExpanded(new Set(firstLevel));
        } else {
          setExpanded(new Set()); // collapsed for large
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        setLoading(false);
      }
    },
    [projectDriveId, refreshKey]
  );

  useEffect(() => {
    // Fire-and-forget is safe here: React 18+ ignores state updates after
    // unmount, and every load() run is idempotent (full listing replace).
    void load();
  }, [load]);

  // ── Drive-identical upload (manage only) ──────────────────────────
  // Drag-and-drop works directly onto the list/grid area itself, and
  // the "+ New" dropdown offers File/Folder upload. This reuses the
  // SAME resilient pipeline as Projects (shared useFolderUpload hook)
  // and the SAME global toast — no new upload logic.
  const startDriveUpload = useCallback(
    (picked: PickedUploadFile[]) => {
      if (picked.length === 0) return;
      const totalBytes = pickedBatchBytes(picked);
      const label =
        picked.length === 1
          ? `Upload "${picked[0]!.file.name}" to ${projectName}`
          : `Upload ${picked.length} files to ${projectName}`;
      setUploading(true);
      setUploadError(null);
      const { finished } = track(label, totalBytes, async (report, setFinalizing) => {
        const sentBaseRef = { value: 0 };
        const tree = await runFolderUpload(picked, report, sentBaseRef);
        setFinalizing();
        if (tree.succeeded === 0) {
          throw new Error(tree.failed[0]?.error || "Upload failed — nothing reached Drive.");
        }
        if (tree.failed.length > 0) {
          console.warn(
            `[FileBrowser] partial upload: ${tree.succeeded}/${picked.length} succeeded, ${tree.failed.length} failed.`
          );
        }
      });
      finished.then(
        () => {
          setUploading(false);
          // Prefer parent's refreshKey bump (fresh fetch), else force fresh directly.
          if (onUploaded) onUploaded();
          else void load(true);
        },
        (err: unknown) => {
          setUploading(false);
          setUploadError(err instanceof Error ? err.message : "Upload failed.");
        }
      );
    },
    [projectName, track, runFolderUpload, onUploaded, load]
  );

  const handleDriveFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = collectFilesFromInput(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (picked.length > 0) startDriveUpload(picked);
    },
    [startDriveUpload]
  );

  const handleDriveFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = collectFilesFromInput(e.target.files);
      if (folderInputRef.current) folderInputRef.current.value = "";
      if (picked.length > 0) startDriveUpload(picked);
    },
    [startDriveUpload]
  );

  const handleDriveDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!manage) return;
      e.preventDefault();
      setDragActive(false);
      setScanning(true);
      setUploadError(null);
      try {
        const picked = await collectFilesFromDrop(e.dataTransfer);
        if (picked.length === 0) {
          setUploadError("That drop contained no files — try different files or a folder.");
          return;
        }
        startDriveUpload(picked);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Could not read the dropped items.");
      } finally {
        setScanning(false);
      }
    },
    [manage, startDriveUpload]
  );

  const tree = useMemo(() => {
    if (!data) return null;
    const t = buildTree(data.files, data.root.name, data.root.id);
    // Annotate descendant counts for warning
    function annotate(n: TreeNode) {
      if (n.isFolder) {
        (n as any).totalDescendantFiles = countDescendantFiles(n);
        for (const c of n.children.values()) annotate(c);
      }
    }
    annotate(t);
    return t;
  }, [data]);

  const flat = useMemo(() => {
    if (!tree) return [];
    return flattenVisible(tree, expanded, sortDir);
  }, [tree, expanded, sortDir]);

  // Reset grid navigation when the underlying folder changes.
  useEffect(() => {
    setGridPath([]);
    setGridLimit(GRID_PAGE_SIZE);
    setOpenMenu(null);
  }, [projectDriveId, data?.root.id]);

  /**
   * Grid's current folder: walk down from the root by name, clamping to
   * the deepest path that still exists (rename/move-away mid-session).
   */
  const gridNav = useMemo(() => {
    if (!tree || !data) return null;
    let node: TreeNode = tree;
    const valid: string[] = [];
    for (const seg of gridPath) {
      const next = Array.from(node.children.values()).find(
        (c) => c.isFolder && c.name === seg
      );
      if (!next) break;
      node = next;
      valid.push(seg);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: TreeNode, b: TreeNode) => dir * a.name.localeCompare(b.name);
    const folders = Array.from(node.children.values())
      .filter((c) => c.isFolder)
      .sort(byName);
    const files = Array.from(node.children.values())
      .filter((c) => !c.isFolder)
      .sort(byName);
    return { node, valid, folders, files };
  }, [tree, data, gridPath, sortDir]);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // accommodate max row height (base ~52px + snippet max-h-20 80px)
    overscan: 10,
  });

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const toggleSelectFolder = useCallback(
    (node: TreeNode) => {
      // For folders, select/deselect all descendant files
      const ids: string[] = [];
      function collect(n: TreeNode) {
        if (n.isFolder) {
          for (const c of n.children.values()) collect(c);
        } else {
          ids.push(n.id);
        }
      }
      collect(node);
      setSelected((prev) => {
        const n = new Set(prev);
        const allSelected = ids.every((id) => n.has(id));
        if (allSelected) ids.forEach((id) => n.delete(id));
        else ids.forEach((id) => n.add(id));
        return n;
      });
    },
    []
  );

  // Download helpers
  const downloadFile = useCallback(async (file: BrowseFile | TreeNode) => {
    const id = (file as BrowseFile).id || (file as TreeNode).id;
    const name = (file as BrowseFile).name || (file as TreeNode).name;
    setDownloading(id);
    try {
      // Use hidden anchor to trigger download with proper headers
      const a = document.createElement("a");
      a.href = `/api/drive/download?id=${encodeURIComponent(id)}`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Brief feedback
      setTimeout(() => setDownloading(null), 1500);
    } finally {
      setDownloading(null);
    }
  }, []);

  const downloadFolder = useCallback(
    async (node: TreeNode) => {
      const folderId = node.id;
      const folderName = node.name;
      // Find total for warning
      const totalFiles = (node as any).totalDescendantFiles || countDescendantFiles(node);
      const totalBytes = sumDescendantBytes(node);
      const sizeStr = formatBytes(totalBytes);
      if (totalFiles > 500 || totalBytes > 500 * 1024 * 1024) {
        const ok = window.confirm(
          `This will download "${folderName}" — ${sizeStr} across ${totalFiles} files — as a single .zip. Continue?\n\nLarge folders stream without buffering, but may take a while.`
        );
        if (!ok) return;
      }
      setDownloading(folderId);
      setZipProgress(`Preparing zip for ${folderName} (${totalFiles} files)…`);
      try {
        const res = await fetch("/api/drive/zip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: folderId, name: folderName }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error || "Zip failed.");
        }
        // Stream download
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Folder download failed.");
      } finally {
        setDownloading(null);
        setZipProgress(null);
      }
    },
    []
  );

  const downloadSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    // Estimate total for warning
    let estBytes = 0;
    let estCount = ids.length;
    if (tree) {
      // Rough estimate by summing selected nodes
      const map = new Map<string, TreeNode>();
      function index(n: TreeNode) {
        map.set(n.id, n);
        if (n.isFolder) for (const c of n.children.values()) index(c);
      }
      if (tree) index(tree);
      estBytes = ids.reduce((s, id) => s + (Number(map.get(id)?.size || 0) || 0), 0);
    }
    if (estCount > 100 || estBytes > 300 * 1024 * 1024) {
      const ok = window.confirm(`Download ${estCount} selected items (${formatBytes(estBytes)}) as one zip?`);
      if (!ok) return;
    }
    setDownloading("selected");
    setZipProgress(`Zipping ${estCount} items…`);
    try {
      const res = await fetch("/api/drive/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, name: `${projectName}-selection` }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Zip failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}-selection.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Selection download failed.");
    } finally {
      setDownloading(null);
      setZipProgress(null);
    }
  }, [selected, projectName, tree]);

  // ── Delete → Drive trash (recoverable, never permanent) ──────────
  // Real Drive ids only: intermediate tree nodes carry synthetic
  // `folder-<path>` ids — filtered here (the server would refuse them
  // anyway, but skipping client-side keeps confirms honest).
  const realDriveIdOf = useCallback((node: TreeNode): string | null => {
    const id = node.file?.id ?? node.id;
    if (!id || id.startsWith("folder-")) return null;
    return id;
  }, []);

  const trashIds = useCallback(
    async (ids: string[], confirmText: string) => {
      if (ids.length === 0) return;
      if (!window.confirm(confirmText)) return;
      setDeleting(ids.length === 1 ? ids[0]! : "selected");
      try {
        const res = await fetch("/api/drive/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Trash failed.");
        const failed = (
          Array.isArray(j?.failed) ? j.failed : []
        ) as { id: string; error: string }[];
        // Refetch (the server invalidated its browse cache on trash) and
        // clear selection — the list itself is the confirmation.
        setSelected(new Set());
        await load();
        if (failed.length > 0) {
          alert(
            `Moved ${ids.length - failed.length} of ${ids.length} items to trash.\nFailed:\n${failed
              .slice(0, 5)
              .map((f) => `• ${f.error}`)
              .join("\n")}`
          );
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Trash failed.");
      } finally {
        setDeleting(null);
      }
    },
    [load]
  );

  const deleteNode = useCallback(
    (node: TreeNode) => {
      const id = realDriveIdOf(node);
      if (!id) return;
      const detail = node.isFolder
        ? `"${node.name}" and everything inside it (${countDescendantFiles(node)} files, ${formatBytes(sumDescendantBytes(node))})`
        : `"${node.name}" (${formatBytes(Number(node.size || 0) || 0)})`;
      void trashIds(
        [id],
        `Move ${detail} to Drive trash?\n\nYou can restore it from Google Drive Trash.`
      );
    },
    [realDriveIdOf, trashIds]
  );

  const deleteSelected = useCallback(() => {
    if (selected.size === 0 || !tree) return;
    // Selection holds file ids (folder-select expands to descendant files);
    // resolve each through the tree to its real Drive id.
    const index = new Map<string, TreeNode>();
    const walk = (n: TreeNode) => {
      index.set(n.id, n);
      if (n.isFolder) for (const c of n.children.values()) walk(c);
    };
    walk(tree);
    const ids = [...new Set(
      Array.from(selected)
        .map((selId) => {
          const node = index.get(selId);
          return node ? realDriveIdOf(node) : null;
        })
        .filter((id): id is string => id !== null)
    )];
    if (ids.length === 0) return;
    void trashIds(
      ids,
      `Move ${ids.length} selected ${ids.length === 1 ? "item" : "items"} to Drive trash?\n\nYou can restore from Google Drive Trash.`
    );
  }, [selected, tree, realDriveIdOf, trashIds]);

  /* ── In-app manager mutations (manage only) ───────────────────────
   * Every op hits the Drive API directly and refetches fresh on success —
   * Drive is the only store, so the list can never drift from it. The
   * server re-verifies root containment on each call; the client-side
   * checks below are just for honest confirms and dialog options.
   */

  /** Index real Drive ids → nodes (synthetic `folder-*` ids excluded). */
  const realIdIndex = useCallback(() => {
    const map = new Map<string, TreeNode>();
    const walk = (n: TreeNode) => {
      const real = n.file?.id ?? (n.id.startsWith("folder-") ? null : n.id);
      if (real) map.set(real, n);
      if (n.isFolder) for (const c of n.children.values()) walk(c);
    };
    if (tree) walk(tree);
    return map;
  }, [tree]);

  /** All real folders for the Move destination picker + New-folder parents. */
  const folderOptions = useCallback((): { id: string; name: string; depth: number }[] => {
    if (!tree || !data) return [];
    const out: { id: string; name: string; depth: number }[] = [
      { id: data.root.id, name: `${data.root.name} (root)`, depth: 0 },
    ];
    const walk = (n: TreeNode, depth: number) => {
      const kids = Array.from(n.children.values())
        .filter((c) => c.isFolder)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const c of kids) {
        const real = c.file?.id ?? (c.id.startsWith("folder-") ? null : c.id);
        if (real) {
          out.push({ id: real, name: c.name, depth });
          walk(c, depth + 1);
        }
      }
    };
    walk(tree, 1);
    return out;
  }, [tree, data]);

  /** Descendant real ids of a folder node (for move cycle-exclusion). */
  const descendantIds = useCallback((node: TreeNode): Set<string> => {
    const ids = new Set<string>();
    const walk = (n: TreeNode) => {
      const real = n.file?.id ?? (n.id.startsWith("folder-") ? null : n.id);
      if (real) ids.add(real);
      if (n.isFolder) for (const c of n.children.values()) walk(c);
    };
    walk(node);
    return ids;
  }, []);

  const runMutation = useCallback(
    async (label: string, work: () => Promise<void>) => {
      setMutating(true);
      try {
        await work();
        // Fresh refetch — server invalidated its listing cache on mutation.
        await load();
      } catch (e) {
        alert(
          e instanceof Error ? `${label} failed: ${e.message}` : `${label} failed.`
        );
      } finally {
        setMutating(false);
      }
    },
    [load]
  );

  const submitNewFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!newFolderParent || !name) return;
    const parent = newFolderParent;
    void runMutation("Create folder", async () => {
      const res = await fetch("/api/drive/create-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: parent.id, name }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not create folder.");
      // Reveal the new folder: expand its parent after reload.
      const index = realIdIndex();
      const parentNode = index.get(parent.id);
      if (parentNode && parentNode.relativePath) {
        setExpanded((prev) => new Set(prev).add(parentNode.relativePath));
      }
      setNewFolderParent(null);
      setNewFolderName("");
    });
  }, [newFolderParent, newFolderName, runMutation, realIdIndex]);

  const submitRename = useCallback(
    (id: string) => {
      const name = renameDraft.trim();
      if (!name) return;
      // Enter keydown + blur can both fire for one edit — one POST only.
      const key = `${id}:${name}`;
      if (renameInflight.current === key) return;
      renameInflight.current = key;
      void runMutation("Rename", async () => {
        try {
          const res = await fetch("/api/drive/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name }),
          });
          const j = await res.json().catch(() => null);
          if (!res.ok) throw new Error(j?.error || "Could not rename.");
          setRenamingId(null);
          setRenameDraft("");
        } finally {
          if (renameInflight.current === key) renameInflight.current = null;
        }
      });
    },
    [renameDraft, runMutation]
  );

  const submitMove = useCallback(() => {
    if (!moveNode || !moveDestId) return;
    const nodeId = realDriveIdOf(moveNode);
    if (!nodeId) return;
    const destId = moveDestId;
    void runMutation("Move", async () => {
      const res = await fetch("/api/drive/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nodeId, destinationParentId: destId }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not move.");
      // Reveal the destination after reload.
      const index = realIdIndex();
      const dest = index.get(destId);
      if (dest && dest.relativePath) {
        setExpanded((prev) => new Set(prev).add(dest.relativePath));
      }
      setMoveNode(null);
      setMoveDestId(null);
    });
  }, [moveNode, moveDestId, realDriveIdOf, runMutation, realIdIndex]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-hairline bg-canvas p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-48 rounded bg-fog" />
          <div className="h-4 w-full rounded bg-fog" />
          <div className="h-64 rounded bg-fog" />
        </div>
      </div>
    );
  }
  if (error || !data || !tree) {
    return (
      <div className="rounded-2xl border border-hairline bg-canvas p-6 text-sm text-error">
        {error || "Could not load files."}
        <button onClick={() => void load()} className="ml-2 underline">
          Retry
        </button>
      </div>
    );
  }

  const totalLabel = `${data.fileCount} files · ${formatBytes(data.totalBytes)}`;

  return (
    <div className="relative rounded-2xl border border-hairline bg-canvas overflow-hidden">
      {/* Hidden Drive upload inputs (manage only) — no persistent drop-zone card */}
      {manage && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleDriveFilesChange}
            className="hidden"
            aria-label="Upload files"
          />
          <input
            ref={folderInputRef}
            type="file"
            onChange={handleDriveFolderChange}
            className="hidden"
            aria-label="Upload folder"
          />
        </>
      )}
      {/* Header — Drive-identical: title + counts, "+ New" dropdown, actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft bg-canvas px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-bold text-ink">{projectName}</h3>
          <p className="font-mono text-[11px] text-steel">{totalLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="font-mono text-xs text-ink">{selected.size} selected</span>
              <button
                onClick={downloadSelected}
                disabled={downloading === "selected"}
                className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
              >
                {downloading === "selected" ? "Zipping…" : "Download selected"}
              </button>
              <button
                onClick={deleteSelected}
                disabled={deleting !== null}
                className="rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold text-error transition-colors hover:border-error disabled:opacity-50"
              >
                {deleting === "selected" ? "Trashing…" : "Delete selected"}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-steel underline">
                Clear
              </button>
            </>
          )}
          {manage && (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNewMenuOpen((v) => !v)}
                  disabled={mutating || uploading}
                  aria-expanded={newMenuOpen}
                  aria-haspopup="menu"
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50"
                  title="Create or upload"
                >
                  <span aria-hidden className="text-sm leading-none">
                    +
                  </span>{" "}
                  New
                </button>
                {newMenuOpen && (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setNewMenuOpen(false)}
                      className="fixed inset-0 z-10 cursor-default bg-transparent"
                    />
                    <div
                      role="menu"
                      className="absolute left-0 top-9 z-20 w-48 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-xl"
                    >
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          setNewFolderParent({ id: data.root.id, name: data.root.name });
                        }}
                        disabled={mutating}
                        className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-fog disabled:opacity-50"
                      >
                        New folder
                      </button>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        disabled={mutating || uploading}
                        className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-fog disabled:opacity-50"
                      >
                        File upload
                      </button>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setNewMenuOpen(false);
                          folderInputRef.current?.click();
                        }}
                        disabled={mutating || uploading}
                        className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-fog disabled:opacity-50"
                      >
                        Folder upload
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => void load(true)}
                disabled={loading || mutating}
                className="grid h-7 w-7 place-items-center rounded-full border border-hairline text-steel transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                title="Reload from Drive"
                aria-label="Reload from Drive"
              >
                <span aria-hidden>⟳</span>
              </button>
            </>
          )}
          <button
            onClick={() => {
              const rootNode = tree;
              const totalFiles = countDescendantFiles(rootNode);
              const totalBytes = sumDescendantBytes(rootNode);
              if (totalFiles > 1000 || totalBytes > 500 * 1024 * 1024) {
                const ok = window.confirm(`Download entire ${contextNoun} "${projectName}" — ${formatBytes(totalBytes)} across ${totalFiles} files — as zip? This streams without buffering.`);
                if (!ok) return;
              }
              // Use zip endpoint for whole project
              setDownloading(data.root.id);
              setZipProgress(`Preparing ${projectName}.zip…`);
              fetch("/api/drive/zip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: data.root.id, name: projectName }),
              })
                .then(async (r) => {
                  if (!r.ok) {
                    const j = await r.json().catch(() => null);
                    throw new Error(j?.error || "Zip failed");
                  }
                  const blob = await r.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${projectName}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                })
                .catch((e) => alert(e instanceof Error ? e.message : "Download failed"))
                .finally(() => {
                  setDownloading(null);
                  setZipProgress(null);
                });
            }}
            disabled={!!downloading}
            className="rounded-full border border-hairline bg-canvas px-4 py-1.5 text-xs font-semibold text-ink hover:border-ink disabled:opacity-50"
          >
            Download all
          </button>
          {onClose && (
            <button onClick={onClose} className="rounded-full border border-hairline px-3 py-1.5 text-xs">
              ✕
            </button>
          )}
        </div>
      </div>
      {manage && uploadError && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline-soft bg-red-50 px-4 py-2 font-mono text-xs text-red-700">
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-red-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {manage && scanning && (
        <div className="border-b border-hairline-soft bg-fog px-4 py-2 font-mono text-xs text-steel">
          Reading dropped items…
        </div>
      )}
      {manage && uploading && (
        <div className="border-b border-hairline-soft bg-azure-soft px-4 py-2 font-mono text-xs text-azure-deep">
          Uploading in background — check progress in the toast at bottom right…
        </div>
      )}
      {/* Sort + view toolbar (shared by grid and list) */}
      <div className="flex items-center justify-between gap-2 border-b border-hairline-soft px-4 py-2">
        <button
          type="button"
          onClick={() => {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            setGridLimit(GRID_PAGE_SIZE);
          }}
          aria-label={`Sort by name, currently ${sortDir === "asc" ? "ascending" : "descending"}`}
          title="Sort by name"
          className="group flex items-center gap-1.5 text-[13px] font-semibold text-ink"
        >
          Name
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full bg-azure text-[11px] font-bold leading-none text-white transition-transform duration-200"
          >
            <span className={`inline-block transition-transform duration-200 ${sortDir === "asc" ? "" : "rotate-180"}`}>
              ↓
            </span>
          </span>
        </button>
        <div
          role="group"
          aria-label="View"
          className="flex items-center gap-1 rounded-full border border-hairline-soft bg-fog/60 p-0.5"
        >
          <button
            type="button"
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
            title="Grid view"
            aria-label="Grid view"
            className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
              view === "grid" ? "bg-canvas text-ink shadow-sm" : "text-steel hover:text-ink"
            }`}
          >
            <GridIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            title="List view"
            aria-label="List view"
            className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
              view === "list" ? "bg-canvas text-ink shadow-sm" : "text-steel hover:text-ink"
            }`}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {zipProgress && (
        <div className="border-b border-hairline-soft bg-amber-50 px-4 py-2 font-mono text-xs text-amber-800">{zipProgress}</div>
      )}

      {view === "grid" && gridNav ? (
        <div
          className="relative bg-canvas px-4 py-3"
          onDragOver={
            manage
              ? (e) => {
                  e.preventDefault();
                  setDragActive(true);
                }
              : undefined
          }
          onDragLeave={manage ? () => setDragActive(false) : undefined}
          onDrop={manage ? handleDriveDrop : undefined}
        >
          {/* Drag overlay — Drive-identical: drop directly onto the list/grid */}
          {manage && dragActive && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-ink bg-ink/5 backdrop-blur-[1px]">
              <p className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow">
                Drop files or folder here to upload
              </p>
            </div>
          )}
          {/* Breadcrumb — every segment clickable + dedicated back/up arrow (bug fix: no dead-ends) */}
          <div className="mb-3 flex items-center gap-2">
            {gridNav.valid.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setGridPath((prev) => prev.slice(0, -1));
                  setGridLimit(GRID_PAGE_SIZE);
                  setOpenMenu(null);
                }}
                aria-label="Go up one level"
                title="Go up one level"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline bg-canvas text-sm leading-none text-steel transition-colors hover:border-ink hover:text-ink"
              >
                <span aria-hidden>←</span>
              </button>
            ) : (
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline-soft bg-fog/50 text-sm leading-none text-stone"
                title="At root"
              >
                ←
              </span>
            )}
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]"
            >
              <button
                type="button"
                onClick={() => {
                  setGridPath([]);
                  setGridLimit(GRID_PAGE_SIZE);
                  setOpenMenu(null);
                }}
                title={data.root.name}
                aria-current={gridNav.valid.length === 0 ? "page" : undefined}
                className={`min-w-0 max-w-[160px] truncate rounded px-1 py-0.5 font-semibold transition-colors hover:bg-fog ${
                  gridNav.valid.length === 0 ? "text-ink" : "text-steel hover:text-ink"
                }`}
              >
                {data.root.name}
              </button>
              {gridNav.valid.map((seg, i) => (
                <span key={`${i}-${seg}`} className="flex min-w-0 items-center gap-1">
                  <span aria-hidden className="text-stone">
                    /
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setGridPath(gridNav.valid.slice(0, i + 1));
                      setGridLimit(GRID_PAGE_SIZE);
                      setOpenMenu(null);
                    }}
                    title={seg}
                    aria-current={i === gridNav.valid.length - 1 ? "page" : undefined}
                    className={`min-w-0 max-w-[160px] truncate rounded px-1 py-0.5 transition-colors hover:bg-fog ${
                      i === gridNav.valid.length - 1
                        ? "font-semibold text-ink"
                        : "text-steel hover:text-ink"
                    }`}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          {/* Folders — compact horizontal cards */}
          {gridNav.folders.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {gridNav.folders.slice(0, gridLimit).map((node) => (
                <FolderCard
                  key={node.relativePath || node.id}
                  node={node}
                  menuOpen={openMenu === (node.relativePath || node.id)}
                  onToggleMenu={() =>
                    setOpenMenu((m) =>
                      m === (node.relativePath || node.id) ? null : node.relativePath || node.id
                    )
                  }
                  onCloseMenu={() => setOpenMenu(null)}
                  onOpen={() => {
                    setGridPath([...gridNav.valid, node.name]);
                    setGridLimit(GRID_PAGE_SIZE);
                    setOpenMenu(null);
                  }}
                  c={{
                    onDownload: () => downloadFolder(node),
                    downloading: downloading === node.id,
                    onDelete: () => deleteNode(node),
                    deleteBusy: deleting !== null,
                    manage,
                    mutating,
                    renaming:
                      renamingId !== null && realDriveIdOf(node) === renamingId,
                    renameDraft,
                    onStartRename: () => {
                      const id = realDriveIdOf(node);
                      if (!id) return;
                      setRenamingId(id);
                      setRenameDraft(node.name);
                    },
                    onRenameDraft: setRenameDraft,
                    onCommitRename: () => {
                      if (renamingId) submitRename(renamingId);
                    },
                    onCancelRename: () => {
                      setRenamingId(null);
                      setRenameDraft("");
                    },
                    onMove: () => {
                      setMoveNode(node);
                      setMoveDestId(null);
                    },
                    onDownloadFolder: () => downloadFolder(node),
                    onNewSubfolder: () => {
                      const id = realDriveIdOf(node);
                      if (!id) return;
                      setNewFolderParent({ id, name: node.name });
                      setNewFolderName("");
                    },
                  }}
                />
              ))}
            </div>
          )}

          {/* Files — thumbnail-forward cards */}
          {gridNav.files.length > 0 && (
            <div
              className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${
                gridNav.folders.length > 0 ? "mt-3" : ""
              }`}
            >
              {gridNav.files.slice(0, gridLimit).map((node) => (
                <FileCard
                  key={node.relativePath || node.id}
                  node={node}
                  menuOpen={openMenu === (node.relativePath || node.id)}
                  onToggleMenu={() =>
                    setOpenMenu((m) =>
                      m === (node.relativePath || node.id) ? null : node.relativePath || node.id
                    )
                  }
                  onCloseMenu={() => setOpenMenu(null)}
                  c={{
                    onDownload: () => downloadFile(node),
                    downloading: downloading === node.id,
                    onDelete: () => deleteNode(node),
                    deleteBusy: deleting !== null,
                    manage,
                    mutating,
                    renaming:
                      renamingId !== null && realDriveIdOf(node) === renamingId,
                    renameDraft,
                    onStartRename: () => {
                      const id = realDriveIdOf(node);
                      if (!id) return;
                      setRenamingId(id);
                      setRenameDraft(node.name);
                    },
                    onRenameDraft: setRenameDraft,
                    onCommitRename: () => {
                      if (renamingId) submitRename(renamingId);
                    },
                    onCancelRename: () => {
                      setRenamingId(null);
                      setRenameDraft("");
                    },
                    onMove: () => {
                      setMoveNode(node);
                      setMoveDestId(null);
                    },
                    onDownloadFolder: () => downloadFile(node),
                  }}
                />
              ))}
            </div>
          )}

          {gridNav.folders.length === 0 && gridNav.files.length === 0 && (
            <p className="p-8 text-center text-sm text-steel">
              {gridNav.valid.length === 0
                ? (emptyText ?? "This folder is empty.")
                : "This folder is empty."}
            </p>
          )}
          {(gridNav.folders.length > gridLimit ||
            gridNav.files.length > gridLimit) && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setGridLimit((l) => l + GRID_PAGE_SIZE)}
                className="rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold text-ink hover:border-ink"
              >
                Show more (
                {Math.max(0, gridNav.folders.length - gridLimit) +
                  Math.max(0, gridNav.files.length - gridLimit)}{" "}
                remaining)
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={parentRef}
          className="relative h-[480px] overflow-auto bg-canvas"
          onDragOver={
            manage
              ? (e) => {
                  e.preventDefault();
                  setDragActive(true);
                }
              : undefined
          }
          onDragLeave={manage ? () => setDragActive(false) : undefined}
          onDrop={manage ? handleDriveDrop : undefined}
        >
          {manage && dragActive && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center border-2 border-dashed border-ink bg-ink/5">
              <p className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow">
                Drop files or folder here to upload
              </p>
            </div>
          )}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const flatNode = flat[virtualRow.index];
            if (!flatNode) return null;
            return (
              <div
                key={flatNode.node.relativePath || flatNode.node.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex items-center gap-2 border-b border-hairline-soft/50 px-2 hover:bg-fog/50"
              >
                <FileRow
                  flatNode={flatNode}
                  depth={flatNode.depth}
                  isExpanded={flatNode.isExpanded}
                  onToggleExpand={toggleExpand}
                  selected={selected.has(flatNode.node.id)}
                  onToggleSelect={toggleSelect}
                  onToggleSelectFolder={toggleSelectFolder}
                  onDownloadFile={downloadFile}
                  onDownloadFolder={downloadFolder}
                  downloading={downloading === flatNode.node.id}
                  onDeleteNode={deleteNode}
                  deleteBusy={deleting !== null}
                  manage={manage}
                  mutating={mutating}
                  renaming={renamingId !== null && realDriveIdOf(flatNode.node) === renamingId}
                  renameDraft={renameDraft}
                  onStartRename={(node) => {
                    const id = realDriveIdOf(node);
                    if (!id) return;
                    setRenamingId(id);
                    setRenameDraft(node.name);
                  }}
                  onRenameDraft={setRenameDraft}
                  onCommitRename={() => {
                    if (renamingId) submitRename(renamingId);
                  }}
                  onCancelRename={() => {
                    setRenamingId(null);
                    setRenameDraft("");
                  }}
                  onMoveNode={(node) => {
                    setMoveNode(node);
                    setMoveDestId(null);
                  }}
                  onNewSubfolder={(node) => {
                    const id = realDriveIdOf(node);
                    if (!id) return;
                    setNewFolderParent({ id, name: node.name });
                    setNewFolderName("");
                  }}
                />
              </div>
            );
          })}
        </div>
        {flat.length === 0 && <p className="p-8 text-center text-sm text-steel">{emptyText ?? `No files in this ${contextNoun} yet.`}</p>}
      </div>
      )}

      <div className="border-t border-hairline-soft bg-fog/30 px-4 py-2 font-mono text-[11px] text-steel">
        {flat.length} visible · {selected.size > 0 ? `${selected.size} selected` : "scroll to load previews lazily"} · cached session
      </div>

      {/* ── New Folder dialog (manage only) ── */}
      {manage && newFolderParent && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitNewFolder();
            }}
            className="w-full max-w-sm rounded-2xl border border-hairline bg-canvas p-5 shadow-2xl"
          >
            <h3 className="font-display text-base font-bold text-ink">New folder</h3>
            <p className="mt-1 truncate font-mono text-[11px] text-steel">
              inside “{newFolderParent.name}”
            </p>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              maxLength={120}
              disabled={mutating}
              aria-label="New folder name"
              className="mt-3 w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewFolderParent(null);
                  setNewFolderName("");
                }}
                disabled={mutating}
                className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-steel transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutating || !newFolderName.trim()}
                className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
              >
                {mutating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Move-to dialog (manage only) ── */}
      {manage && moveNode && (
        <MoveDialog
          node={moveNode}
          options={folderOptions()}
          excludedIds={moveNode.isFolder ? descendantIds(moveNode) : new Set<string>()}
          selectedId={moveDestId}
          onSelect={setMoveDestId}
          busy={mutating}
          onCancel={() => {
            setMoveNode(null);
            setMoveDestId(null);
          }}
          onConfirm={submitMove}
        />
      )}
    </div>
  );
}

/* ── Move destination picker ─────────────────────────────────────── */
function MoveDialog({
  node,
  options,
  excludedIds,
  selectedId,
  onSelect,
  busy,
  onCancel,
  onConfirm,
}: {
  node: TreeNode;
  options: { id: string; name: string; depth: number }[];
  /** Ids that would cycle the tree (node itself + descendants). Hidden. */
  excludedIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const visible = options.filter((o) => !excludedIds.has(o.id));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl border border-hairline bg-canvas p-5 shadow-2xl">
        <h3 className="font-display text-base font-bold text-ink">Move to…</h3>
        <p className="mt-1 truncate font-mono text-[11px] text-steel">
          moving “{node.name}”
        </p>
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-hairline-soft bg-fog/40 p-2">
          {visible.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              disabled={busy}
              style={{ paddingLeft: `${8 + o.depth * 16}px` }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                selectedId === o.id
                  ? "bg-ink font-semibold text-white"
                  : "text-ink hover:bg-fog"
              }`}
            >
              <FolderIcon className="h-4 w-4 shrink-0 opacity-70" />
              <span className="truncate">{o.name}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <p className="p-3 text-xs text-steel">No destination available.</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-steel transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !selectedId}
            className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
          >
            {busy ? "Moving…" : "Move here"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Individual row with lazy preview ──────────────────────────── */
function FileRow({
  flatNode,
  depth,
  isExpanded,
  onToggleExpand,
  selected,
  onToggleSelect,
  onToggleSelectFolder,
  onDownloadFile,
  onDownloadFolder,
  downloading,
  onDeleteNode,
  deleteBusy,
  manage,
  mutating,
  renaming,
  renameDraft,
  onStartRename,
  onRenameDraft,
  onCommitRename,
  onCancelRename,
  onMoveNode,
  onNewSubfolder,
}: {
  flatNode: FlatNode;
  depth: number;
  isExpanded: boolean;
  onToggleExpand: (path: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectFolder: (node: TreeNode) => void;
  onDownloadFile: (file: BrowseFile | TreeNode) => void;
  onDownloadFolder: (node: TreeNode) => void;
  downloading: boolean;
  onDeleteNode: (node: TreeNode) => void;
  deleteBusy: boolean;
  manage: boolean;
  mutating: boolean;
  renaming: boolean;
  renameDraft: string;
  onStartRename: (node: TreeNode) => void;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onMoveNode: (node: TreeNode) => void;
  onNewSubfolder: (node: TreeNode) => void;
}) {
  const { node } = flatNode;
  const isFolder = node.isFolder || node.mimeType === "application/vnd.google-apps.folder";
  const [thumbnailError, setThumbnailError] = useState(false);
  // Lazy code snippet (shared session cache with grid doc previews).
  const { snippet, loading: snippetLoading, error: snippetError } =
    useFileSnippet(node.mimeType, node.name, node.id, !isFolder);

  return (
    <div className="flex w-full items-center gap-2 pl-2 pr-2" style={{ paddingLeft: `${8 + depth * 16}px` }}>
      {/* Expand/collapse for folders */}
      {isFolder ? (
        <button
          onClick={() => onToggleExpand(node.relativePath)}
          className="grid h-7 w-7 place-items-center rounded hover:bg-fog text-steel"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <span className={`text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}>▸</span>
        </button>
      ) : (
        <span className="h-7 w-7" />
      )}

      {/* Checkbox for multi-select */}
      <input
        type="checkbox"
        checked={selected}
        onChange={() => (isFolder ? onToggleSelectFolder(node) : onToggleSelect(node.id))}
        className="h-4 w-4 rounded border-hairline"
      />

      {/* Preview */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-fog border border-hairline-soft grid place-items-center">
        {isFolder ? (
          <FolderIcon className="h-5 w-5 text-steel" />
        ) : isImage(node.mimeType, node.name) ? (
          node.thumbnailLink && !thumbnailError ? (
            <img
              src={node.thumbnailLink}
              alt={node.name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setThumbnailError(true)}
            />
          ) : (
            <span className="text-lg">🖼️</span>
          )
        ) : isCodeText(node.mimeType, node.name) ? (
          <span className="font-mono text-[10px] font-bold text-ink">{"</>"}</span>
        ) : (
          <span className="text-lg">{fileIconFor(node.mimeType, node.name)}</span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => onRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={onCommitRename}
            disabled={mutating}
            maxLength={120}
            aria-label={`Rename ${node.name}`}
            className="w-full rounded-lg border border-ink bg-canvas px-2 py-1 text-sm font-medium text-ink focus:outline-none"
          />
        ) : (
          <p title={node.name} className="truncate text-sm font-medium text-ink">{node.name}</p>
        )}
        <p className="truncate font-mono text-[11px] text-stone">
          {isFolder ? `${(node as any).totalDescendantFiles ?? "?"} files` : formatBytes(Number(node.size || 0) || 0)} · {node.mimeType.split("/").pop()}
        </p>
        {/* Code snippet preview (lazy) */}
        {!isFolder && isCodeText(node.mimeType, node.name) && (
          <div className="mt-1 max-h-20 overflow-hidden rounded bg-ink/5 p-2 font-mono text-[11px] leading-tight text-ink/80">
            {snippetLoading ? (
              <span className="animate-pulse">Loading preview…</span>
            ) : snippet ? (
              <pre className="whitespace-pre-wrap break-all">{snippet.slice(0, 600)}</pre>
            ) : snippetError ? (
              <span className="text-stone">No preview</span>
            ) : (
              <span className="text-stone">—</span>
            )}
          </div>
        )}
      </div>

      {/* Download + trash actions */}
      <div className="flex shrink-0 items-center gap-1.5">
      {isFolder ? (
        <button
          onClick={() => onDownloadFolder(node)}
          disabled={downloading}
          className="rounded-full border border-hairline bg-canvas px-3 py-1 text-xs font-semibold text-ink hover:border-ink disabled:opacity-50"
          title="Download folder as zip"
        >
          {downloading ? "Zipping…" : "Download"}
        </button>
      ) : (
        <button
          onClick={() => onDownloadFile(node as any)}
          disabled={downloading}
          className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
          title="Download file"
        >
          {downloading ? "…" : "Download"}
        </button>
      )}
      <button
        onClick={() => onDeleteNode(node)}
        disabled={deleteBusy}
        className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-stone transition-colors hover:border-error hover:text-error disabled:opacity-50"
        title={isFolder ? "Move folder to Drive trash" : "Move file to Drive trash"}
      >
        Delete
      </button>
      {manage && (
        <>
          <button
            onClick={() => onStartRename(node)}
            disabled={mutating || renaming}
            className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-stone transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            title={`Rename ${isFolder ? "folder" : "file"} in Drive`}
          >
            Rename
          </button>
          <button
            onClick={() => onMoveNode(node)}
            disabled={mutating}
            className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-stone transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            title={`Move ${isFolder ? "folder" : "file"} to another folder`}
          >
            Move
          </button>
          {isFolder && (
            <button
              onClick={() => onNewSubfolder(node)}
              disabled={mutating}
              className="grid h-7 w-7 place-items-center rounded-full border border-transparent text-base font-bold leading-none text-stone transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              title={`New subfolder inside "${node.name}"`}
              aria-label={`New subfolder inside ${node.name}`}
            >
              +
            </button>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/* ── Grid view cards (reference layout) ─────────────────────────────
 * Folders-first 4-column card grid: compact horizontal folder cards,
 * thumbnail-forward file cards, ⋮ menus carrying the same actions as the
 * list rows. Thumbnails prefer Drive's thumbnailLink (real image / video
 * frame / rendered doc); per-type tiles cover what Drive can't thumb
 * (audio et al.).
 */

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function CardMenu({
  open,
  onClose,
  onToggle,
  label,
  items,
}: {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
  label: string;
  items: MenuItem[];
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) onClose();
          else onToggle();
        }}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className="grid h-7 w-7 place-items-center rounded-full text-base font-bold leading-none text-steel transition-colors hover:bg-fog hover:text-ink"
      >
        <span aria-hidden>⋮</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={onClose}
            className="fixed inset-0 z-20 cursor-default bg-transparent"
          />
          <div
            role="menu"
            className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-xl"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                  item.onClick();
                }}
                disabled={item.disabled}
                className={`block w-full px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50 ${
                  item.danger
                    ? "text-error hover:bg-error-bg"
                    : "text-ink hover:bg-fog"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface CardCallbacks {
  onDownload: () => void;
  downloading: boolean;
  onDelete: () => void;
  deleteBusy: boolean;
  manage: boolean;
  mutating: boolean;
  renaming: boolean;
  renameDraft: string;
  onStartRename: () => void;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onMove: () => void;
}

function cardMenuItems(
  isFolder: boolean,
  c: CardCallbacks & { onDownloadFolder: () => void; onNewSubfolder?: () => void }
): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: isFolder ? "Download as zip" : "Download",
      onClick: isFolder ? c.onDownloadFolder : c.onDownload,
      disabled: c.downloading || c.mutating,
    },
  ];
  if (c.manage) {
    items.push(
      { label: "Rename", onClick: c.onStartRename, disabled: c.mutating || c.renaming },
      { label: "Move", onClick: c.onMove, disabled: c.mutating }
    );
    if (isFolder && c.onNewSubfolder) {
      items.push({ label: "New subfolder", onClick: c.onNewSubfolder, disabled: c.mutating });
    }
  }
  items.push({
    label: "Delete",
    onClick: c.onDelete,
    danger: true,
    disabled: c.deleteBusy || c.mutating,
  });
  return items;
}

function RenameInput({
  name,
  draft,
  onDraft,
  onCommit,
  onCancel,
  disabled,
}: {
  name: string;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={onCommit}
      disabled={disabled}
      maxLength={120}
      aria-label={`Rename ${name}`}
      onClick={(e) => e.stopPropagation()}
      className="w-full rounded-lg border border-ink bg-canvas px-2 py-1 text-sm font-medium text-ink focus:outline-none"
    />
  );
}

function FolderCard({
  node,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpen,
  c,
}: {
  node: TreeNode;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpen: () => void;
  c: CardCallbacks & { onDownloadFolder: () => void; onNewSubfolder: () => void };
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline-soft bg-fog/70 px-3 py-2.5 transition-colors hover:border-hairline">
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${node.name}`}
        aria-label={`Open folder ${node.name}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink"
      >
        <FolderIcon className="h-6 w-6" />
      </button>
      <div className="min-w-0 flex-1">
        {c.renaming ? (
          <RenameInput
            name={node.name}
            draft={c.renameDraft}
            onDraft={c.onRenameDraft}
            onCommit={c.onCommitRename}
            onCancel={c.onCancelRename}
            disabled={c.mutating}
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            title={node.name}
            className="block w-full truncate text-left text-sm font-medium text-ink"
          >
            {node.name}
          </button>
        )}
      </div>
      <CardMenu
        open={menuOpen}
        onClose={onCloseMenu}
        onToggle={onToggleMenu}
        label={`Options for ${node.name}`}
        items={cardMenuItems(true, c)}
      />
    </div>
  );
}

/** Small type glyph shown in file-card headers, colored by media family. */
function FileTypeGlyph({ kind }: { kind: MediaKind }) {
  if (kind === "audio")
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#ef4444] text-white">
        <MusicIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (kind === "video")
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#ef4444] text-white">
        <PlayIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (kind === "image")
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#ef4444] text-white">
        <ImageIcon className="h-3.5 w-3.5" />
      </span>
    );
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-azure-soft text-azure-deep">
      <DocIcon className="h-3.5 w-3.5" />
    </span>
  );
}

/** Large preview: Drive thumbnail first, per-type tile fallback. */
function FileThumb({ node }: { node: TreeNode }) {
  const [failed, setFailed] = useState(false);
  const kind = mediaKind(node.mimeType, node.name);
  const raw = node.thumbnailLink ?? node.file?.thumbnailLink;
  const thumb =
    raw && /^(https?:)?\/\//.test(raw)
      ? raw.replace(/=s\d+$/, "=s400")
      : null;
  const { snippet, loading } = useFileSnippet(
    node.mimeType,
    node.name,
    node.id,
    kind === "code"
  );

  if (thumb && !failed) {
    return (
      <img
        src={thumb}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  if (kind === "audio") {
    return (
      <div className="grid h-full w-full place-items-center bg-[#ef4444]">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-white">
          <MusicIcon className="h-8 w-8" />
        </span>
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="grid h-full w-full place-items-center bg-ink">
        <PlayIcon className="h-12 w-12 text-white" />
      </div>
    );
  }
  if (kind === "code") {
    return (
      <div className="h-full w-full overflow-hidden bg-canvas p-3 text-left">
        {loading ? (
          <span className="animate-pulse font-mono text-[11px] text-stone">
            Loading preview…
          </span>
        ) : snippet ? (
          <pre className="max-h-full overflow-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-ink/80">
            {snippet.slice(0, 800)}
          </pre>
        ) : (
          <span className="font-mono text-[11px] font-bold text-steel">{"</>"}</span>
        )}
      </div>
    );
  }
  if (kind === "image") {
    return (
      <div className="grid h-full w-full place-items-center bg-fog">
        <ImageIcon className="h-10 w-10 text-stone" />
      </div>
    );
  }
  return (
    <div className="grid h-full w-full place-items-center bg-azure-soft">
      <DocIcon className="h-10 w-10 text-azure-deep" />
    </div>
  );
}

function FileCard({
  node,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  c,
}: {
  node: TreeNode;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  c: CardCallbacks & { onDownloadFolder: () => void };
}) {
  const kind = mediaKind(node.mimeType, node.name);
  return (
    <div className="rounded-xl border border-hairline bg-canvas transition-colors hover:border-steel/40">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <FileTypeGlyph kind={kind} />
        <div className="min-w-0 flex-1">
          {c.renaming ? (
            <RenameInput
              name={node.name}
              draft={c.renameDraft}
              onDraft={c.onRenameDraft}
              onCommit={c.onCommitRename}
              onCancel={c.onCancelRename}
              disabled={c.mutating}
            />
          ) : (
            <p title={node.name} className="truncate text-[13px] font-medium text-ink">
              {node.name}
            </p>
          )}
        </div>
        <CardMenu
          open={menuOpen}
          onClose={onCloseMenu}
          onToggle={onToggleMenu}
          label={`Options for ${node.name}`}
          items={cardMenuItems(false, c)}
        />
      </div>
      <div className="aspect-[4/3] w-full overflow-hidden rounded-b-xl border-t border-hairline-soft bg-fog">
        <FileThumb node={node} />
      </div>
    </div>
  );
}
