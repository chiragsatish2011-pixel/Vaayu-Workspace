"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatBytes } from "@/components/UploadProgressBar";
import { FolderIcon, BoxIcon } from "@/components/icons";

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

function flattenVisible(root: TreeNode, expanded: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];
  function walk(n: TreeNode, depth: number) {
    // Don't include root itself in list — its children are top level
    for (const child of Array.from(n.children.values()).sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
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

/* ── Component ─────────────────────────────────────────────────────
 * General-purpose Drive folder browser. Originally built for per-project
 * folders; now also rooted at the team folder by the Files page — pass any
 * folder id as `projectDriveId` plus a display `projectName`. Delete moves
 * items to Drive trash (recoverable), never permanent-deletes.
 */
export function FileBrowser({
  projectId,
  projectDriveId,
  projectName,
  emptyText,
  contextNoun = "project",
  refreshKey = 0,
  onClose,
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
  onClose?: () => void;
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

  // Fetch browse data (extracted so delete/upload flows can refetch on demand)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/drive/browse?id=${encodeURIComponent(projectDriveId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "Could not load folder.");
      setData(j as BrowseResponse);
      // Default: expand first level only for large projects, or all for small
      // Requirement 3: collapsed default, only first level expanded for huge
      const tree = buildTree((j as BrowseResponse).files, (j as BrowseResponse).root.name, (j as BrowseResponse).root.id);
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
  }, [projectDriveId, refreshKey]);

  useEffect(() => {
    // Fire-and-forget is safe here: React 18+ ignores state updates after
    // unmount, and every load() run is idempotent (full listing replace).
    void load();
  }, [load]);

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
    return flattenVisible(tree, expanded);
  }, [tree, expanded]);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // row height
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
    <div className="rounded-2xl border border-hairline bg-canvas overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft bg-fog/50 px-4 py-3">
        <div>
          <h3 className="font-display text-sm font-bold text-ink">{projectName}</h3>
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
      {zipProgress && (
        <div className="border-b border-hairline-soft bg-amber-50 px-4 py-2 font-mono text-xs text-amber-800">{zipProgress}</div>
      )}

      {/* Virtualized tree */}
      <div ref={parentRef} className="h-[480px] overflow-auto bg-canvas">
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
                />
              </div>
            );
          })}
        </div>
        {flat.length === 0 && <p className="p-8 text-center text-sm text-steel">{emptyText ?? `No files in this ${contextNoun} yet.`}</p>}
      </div>

      <div className="border-t border-hairline-soft bg-fog/30 px-4 py-2 font-mono text-[11px] text-steel">
        {flat.length} visible · {selected.size > 0 ? `${selected.size} selected` : "scroll to load previews lazily"} · cached session
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
}) {
  const { node } = flatNode;
  const isFolder = node.isFolder;
  const [snippet, setSnippet] = useState<string | null>(null);
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  // Lazy-load code snippet only when row becomes visible and is code file
  useEffect(() => {
    if (isFolder) return;
    if (!isCodeText(node.mimeType, node.name)) return;
    if (hasFetchedRef.current) return;
    if (snippetCache.has(node.id)) {
      setSnippet(snippetCache.get(node.id)!.snippet);
      return;
    }
    hasFetchedRef.current = true;
    let cancelled = false;
    setSnippetLoading(true);
    // Use AbortController to cancel if scrolled past quickly
    const ctrl = new AbortController();
    fetch(`/api/drive/snippet?id=${encodeURIComponent(node.id)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "No preview");
        return j as { snippet: string };
      })
      .then((j) => {
        if (cancelled) return;
        snippetCache.set(node.id, { snippet: j.snippet, truncated: false });
        setSnippet(j.snippet);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSnippetError(e instanceof Error ? e.message : "No preview");
      })
      .finally(() => {
        if (!cancelled) setSnippetLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [isFolder, node.id, node.mimeType, node.name]);

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
          node.thumbnailLink ? (
            <img
              src={node.thumbnailLink}
              alt={node.name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
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
        <p className="truncate text-sm font-medium text-ink">{node.name}</p>
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
      </div>
    </div>
  );
}
