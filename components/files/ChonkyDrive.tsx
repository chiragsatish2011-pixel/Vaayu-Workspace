// @ts-nocheck
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markPanelSeen } from "@/lib/workspaceUnread";
// @ts-ignore - chonky2 types via exports map not resolved by TS in this config
import {
  FileBrowser,
  FileContextMenu,
  FileList,
  FileNavbar,
  FileToolbar,
  ChonkyActions,
  defineFileAction,
  // @ts-ignore
} from "chonky2";
import type { FileData, FileArray } from "chonky2";
import { formatBytes } from "@/components/UploadProgressBar";
import { useUploads } from "@/components/UploadManager";
import { useFolderUpload } from "@/components/useFolderUpload";
import { collectFilesFromInput, collectFilesFromDrop, pickedBatchBytes, type PickedUploadFile } from "@/components/folderWalk";

/**
 * Team Files browser — Drive-style LAZY loading.
 *
 * The old design recursively synced the ENTIRE Drive tree on every open
 * and after every mutation (create/trash/move/upload): hundreds of Drive
 * API calls, multi-MB responses, 10s+ spins, and rate-limit 403s on big
 * team folders ("sync errors" + lag). One failing subfolder failed everything.
 *
 * Now each folder loads ONLY its immediate children
 * (`/api/drive/browse?shallow=1` — one cheap, server-cached Drive call),
 * visited folders stay in a session cache (back/forward is instant), and
 * mutations reload just the current folder. Every id is a real Drive id —
 * the fragile synthetic `folder-*` ids and name-based navigation are gone,
 * so operations can no longer land in the wrong folder.
 */

interface ChainEntry {
  id: string;
  name: string;
}

interface FolderCacheEntry {
  children: any[];
  fileCount: number;
  totalBytes: number;
}

export function ChonkyDrive({ rootId, rootName, refreshKey, onUploaded }: { rootId: string; rootName: string; refreshKey?: number; onUploaded?: () => void }) {
  const [chain, setChain] = useState<ChainEntry[]>([]);
  const [cache, setCache] = useState<Record<string, FolderCacheEntry>>({});
  const cacheRef = useRef<Record<string, FolderCacheEntry>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { track } = useUploads();
  const { runFolderUpload } = useFolderUpload();
  // Stale-response guard: navigation overtakes in-flight fetches.
  const requestSeq = useRef(0);
  const initialRefreshKey = useRef(refreshKey ?? 0);

  const currentId = chain.length > 0 ? chain[chain.length - 1]!.id : rootId;
  const current = cache[currentId] ?? null;
  const isRoot = chain.length === 0;
  const currentIdRef = useRef(currentId);
  // Mirror latest folder for deferred callbacks (upload completions,
  // refresh timers) — plain ref sync, no state involved.
  useEffect(() => {
    currentIdRef.current = currentId;
  });

  const persistCache = useCallback((folderId: string, entry: FolderCacheEntry) => {
    cacheRef.current = { ...cacheRef.current, [folderId]: entry };
    setCache(cacheRef.current);
  }, []);

  const clearCache = useCallback(() => {
    cacheRef.current = {};
    setCache({});
  }, []);

  const loadFolder = useCallback(async (folderId: string, opts?: { fresh?: boolean }) => {
    if (!opts?.fresh && cacheRef.current[folderId]) {
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    const hasCache = Boolean(cacheRef.current[folderId]);
    if (hasCache) {
      setRefreshing(true);
    } else {
      setError(null);
    }
    try {
      const url = `/api/drive/browse?id=${encodeURIComponent(folderId)}&shallow=1${opts?.fresh ? "&fresh=1" : ""}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "Could not load folder.");
      if (seq !== requestSeq.current) return; // navigated away mid-flight
      persistCache(folderId, {
        children: Array.isArray(j?.files) ? j.files : [],
        fileCount: typeof j?.fileCount === "number" ? j.fileCount : 0,
        totalBytes: typeof j?.totalBytes === "number" ? j.totalBytes : 0,
      });
      setError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      if (seq === requestSeq.current) {
        setRefreshing(false);
      }
    }
  }, [persistCache]);

  // Initial open (+ team-root switches). Deferred so state settles first.
  useEffect(() => {
    const t = setTimeout(() => {
      setChain([]);
      clearCache();
      setError(null);
      void loadFolder(rootId);
    }, 0);
    return () => clearTimeout(t);
  }, [rootId, loadFolder, clearCache]);

  // External refresh signal (e.g. an upload finished elsewhere): drop the
  // session cache and re-read the current folder fresh.
  useEffect(() => {
    if ((refreshKey ?? 0) === initialRefreshKey.current) return;
    const t = setTimeout(() => {
      clearCache();
      void loadFolder(currentIdRef.current, { fresh: true });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => { markPanelSeen("files"); }, []);
  useEffect(() => { folderInputRef.current?.setAttribute("webkitdirectory", ""); }, []);

  const openFolder = useCallback((entry: ChainEntry) => {
    setChain((prev) => {
      const i = prev.findIndex((e) => e.id === entry.id);
      return i >= 0 ? prev.slice(0, i + 1) : [...prev, entry];
    });
    void loadFolder(entry.id);
  }, [loadFolder]);

  const goToParent = useCallback(() => {
    const parent = chain.length > 1 ? chain[chain.length - 2]! : null;
    setChain((prev) => prev.slice(0, -1));
    void loadFolder(parent ? parent.id : rootId);
  }, [chain, rootId, loadFolder]);

  const reloadCurrent = useCallback((fresh = true) => {
    return loadFolder(currentIdRef.current, { fresh });
  }, [loadFolder]);

  const folderChain = useMemo(() => {
    const out: FileData[] = [{ id: rootId, name: rootName, isDir: true } as any];
    for (const e of chain) out.push({ id: e.id, name: e.name, isDir: true } as any);
    return out;
  }, [chain, rootId, rootName]);

  const files: FileArray = useMemo(() => {
    if (!current) return [];
    const out: FileData[] = [];
    for (const child of current.children) {
      const name = String(child.name ?? "");
      if (!name) continue;
      const lower = name.toLowerCase();
      // Hide internal system folders/files from the team root view.
      if (isRoot && child.isFolder && (lower === "avatars" || lower === "voice notes")) continue;
      if (isRoot && !child.isFolder && lower.startsWith("avatar-")) continue;
      const isDir = child.isFolder === true;
      const size = child.size ? Number(child.size) : undefined;
      const modDate = child.modifiedTime ? new Date(child.modifiedTime) : undefined;
      const thumb = child.thumbnailLink ? String(child.thumbnailLink).replace(/=s\d+$/, "=s400") : undefined;
      const dot = name.lastIndexOf(".");
      out.push({
        id: String(child.id),
        name,
        isDir,
        size,
        modDate,
        thumbnailUrl: !isDir ? thumb : undefined,
        ext: !isDir && dot > 0 ? name.slice(dot).toLowerCase() : undefined,
        // keep raw for handlers
        driveFile: child,
        realId: String(child.id),
      } as any);
    }
    // sort folders first like Drive
    out.sort((a, b) => {
      if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    return out;
  }, [current, isRoot]);

  // map chonky file id -> raw child for handlers
  const idToNode = useMemo(() => {
    const m = new Map<string, any>();
    if (!current) return m;
    for (const child of current.children) m.set(String(child.id), child);
    return m;
  }, [current]);

  const startUpload = useCallback((picked: PickedUploadFile[]) => {
    if (picked.length === 0) return;
    const total = pickedBatchBytes(picked);
    const label = picked.length === 1 ? `Upload "${picked[0]!.file.name}"` : `Upload ${picked.length} files`;
    const { finished } = track(label, total, async (report) => {
      const ref = { value: 0 };
      const result = await runFolderUpload(picked, report, ref);
      if (result.succeeded === 0) throw new Error(result.failed[0]?.error || "Upload failed");
    });
    finished.then(() => {
      if (onUploaded) {
        // FilesManager bumps refreshKey -> the effect above clears the
        // cache and re-reads the current folder fresh.
        onUploaded();
      } else {
        clearCache();
        void reloadCurrent(true);
      }
    }, () => {});
  }, [track, runFolderUpload, onUploaded, clearCache, reloadCurrent]);

  const downloadBlob = useCallback(async (url: string, body: unknown, filename: string) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Download failed");
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  }, []);

  const handleFileAction = useCallback(async (data: any) => {
    const { id, payload } = data as { id: string; payload: any };
    // Navigation
    if (id === ChonkyActions.OpenFiles.id) {
      const list = payload.files as FileData[];
      const file = list?.[0];
      if (!file) return;
      if (file.isDir) {
        // Folder open — id-based, so breadcrumb jumps and duplicate
        // folder names both resolve to the right place.
        openFolder({ id: String(file.id), name: String(file.name) });
        return;
      }
      // preview file
      const node = idToNode.get(String(file.id));
      if (node) setPreview(node);
      else setPreview({ name: String(file.name), mimeType: "application/octet-stream", size: (file as any).size, id: String(file.id), file: (file as any).driveFile } as any);
      return;
    }
    if (id === ChonkyActions.OpenParentFolder.id) {
      goToParent();
      return;
    }
    if (id === "create_folder") {
      const n = window.prompt("New folder name");
      if (!n || !n.trim()) return;
      try {
        const res = await fetch("/api/drive/create-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: currentIdRef.current, name: n.trim() }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Create failed");
        await reloadCurrent(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Create failed");
      }
      return;
    }
    if (id === ChonkyActions.DeleteFiles.id) {
      const sel = payload.files as FileData[];
      const ids: string[] = (sel ?? []).map((f: any) => String(f.realId || f.id)).filter(Boolean);
      if (ids.length === 0) return;
      if (!window.confirm(`Move ${ids.length} item(s) to trash? You can restore from Google Drive Trash.`)) return;
      try {
        const res = await fetch("/api/drive/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Trash failed");
        await reloadCurrent(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Trash failed");
      }
      return;
    }
    if (id === ChonkyActions.DownloadFiles.id) {
      const list = (payload.files as FileData[]) ?? [];
      if (list.length === 0) return;
      try {
        if (list.length === 1) {
          const f: any = list[0];
          if (f.isDir) {
            await downloadBlob("/api/drive/zip", { id: String(f.realId || f.id), name: String(f.name) }, `${String(f.name)}.zip`);
          } else {
            const a = document.createElement("a");
            a.href = `/api/drive/download?id=${encodeURIComponent(String(f.realId || f.id))}`;
            a.download = String(f.name);
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        } else {
          const ids = list.map((f: any) => String(f.realId || f.id)).filter(Boolean);
          if (ids.length === 0) return;
          await downloadBlob("/api/drive/zip", { ids, name: "selection" }, "selection.zip");
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Download failed");
      }
      return;
    }
    if (id === "upload_files") {
      fileInputRef.current?.click();
      return;
    }
    if (id === "upload_folder") {
      folderInputRef.current?.click();
      return;
    }
    if (id === ChonkyActions.MoveFiles.id) {
      // chonky move payload: {files, destination}
      const filesToMove = payload.files as FileData[];
      const dest = payload.destination as FileData | null;
      if (!filesToMove || !dest) return;
      const destId = String((dest as any).realId || dest.id);
      const moveIds = filesToMove.map((f: any) => String(f.realId || f.id)).filter(Boolean);
      if (moveIds.length === 0) return;
      try {
        for (const mid of moveIds) {
          const res = await fetch("/api/drive/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mid, destinationParentId: destId }) });
          const j = await res.json().catch(() => null);
          if (!res.ok) throw new Error(j?.error || "Move failed");
        }
        await reloadCurrent(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Move failed");
      }
      return;
    }
  }, [idToNode, openFolder, goToParent, reloadCurrent, downloadBlob]);

  const handleFilesPicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = collectFilesFromInput(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (picked.length) startUpload(picked);
  }, [startUpload]);

  const handleFolderPicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = collectFilesFromInput(e.target.files);
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (picked.length) startUpload(picked);
  }, [startUpload]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const picked = await collectFilesFromDrop(e.dataTransfer);
      if (picked.length) startUpload(picked);
    } catch {}
  }, [startUpload]);

  const fileActions = useMemo(() => {
    const uploadFolder = defineFileAction({ id: "upload_folder", button: { name: "Folder upload", toolbar: true, icon: "upload" as any } } as any);
    return [
      ChonkyActions.CreateFolder,
      ChonkyActions.UploadFiles,
      uploadFolder,
      ChonkyActions.DeleteFiles,
      ChonkyActions.DownloadFiles,
    ];
  }, []);

  if (error && !current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-white p-12 text-center dark:bg-[#131316]">
        <p className="text-sm font-medium text-ink">Couldn&apos;t load this folder</p>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => void reloadCurrent(true)} className="mt-3 rounded-full bg-[#0a0a0a] px-5 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Retry</button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-[#f8f9fa] p-4 dark:bg-[#09090b]">
        <div className="h-12 animate-pulse rounded-xl bg-white dark:bg-[#1a1a1e]" />
        <div className="h-64 animate-pulse rounded-2xl bg-white dark:bg-[#1a1a1e]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8f9fa] dark:bg-[#09090b]" onDragOver={(e)=>{e.preventDefault();}} onDrop={handleDrop}>
      <input ref={fileInputRef} type="file" multiple onChange={handleFilesPicked} className="hidden" />
      <input ref={folderInputRef} type="file" onChange={handleFolderPicked} className="hidden" />
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white dark:bg-[#131316]">
        <div className="flex flex-1 min-h-0 flex-col" style={{ height: "100%" }}>
          <FileBrowser
            files={files as any}
            folderChain={folderChain as any}
            fileActions={fileActions as any}
            onFileAction={handleFileAction as any}
            disableDragAndDropProvider={false}
          >
            <FileNavbar />
            <FileToolbar />
            <FileList />
            <FileContextMenu />
          </FileBrowser>
        </div>
        <div className="flex items-center gap-3 border-t border-[#e8eaed] bg-[#f8f9fa] px-4 py-2 text-xs text-[#5f6368] dark:border-[#27272a] dark:bg-[#0f0f12] dark:text-[#a1a1aa]">
          <span>{current.fileCount} files · {formatBytes(current.totalBytes)}{refreshing ? " · Refreshing…" : ""}</span>
          {error && (
            <button onClick={() => void reloadCurrent(true)} className="rounded-full border border-hairline px-2.5 py-0.5 font-medium hover:border-ink" title={error}>
              Sync failed — retry
            </button>
          )}
          <span className="ml-auto hidden sm:inline">Drag files here to upload · Right-click for actions · Double-click to open/preview</span>
        </div>
      </div>

      {preview && (
        <ChonkyPreview node={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function ChonkyPreview({ node, onClose }: { node: any; onClose: () => void }) {
  const mime = String(node.mimeType || "application/octet-stream");
  const name = String(node.name || "File");
  const size = node.size ? formatBytes(Number(node.size)||0) : "";
  const id = String(node.file?.id || node.id);
  const url = `/api/drive/download?id=${encodeURIComponent(id)}`;
  const isImg = mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
  const isVid = mime.startsWith("video/") || /\.(mp4|mov|webm|avi)$/i.test(name);
  const isAud = mime.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a)$/i.test(name);
  const isPdf = mime.includes("pdf");

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1f1f1f]/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 bg-[#1f1f1f] px-4 py-3 text-white">
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">✕</button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <span className="hidden font-mono text-xs text-white/60 sm:block">{size} · {mime.split("/").pop()}</span>
        <a href={url} download className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#1f1f1f]">Download</a>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 overflow-auto" onClick={onClose}>
        <div className="max-h-full max-w-5xl w-full" onClick={(e)=>e.stopPropagation()}>
          {isImg ? (
            <img src={url} alt={name} className="max-h-[80vh] w-full object-contain bg-white rounded-xl shadow-2xl" />
          ) : isVid ? (
            <video controls src={url} className="max-h-[80vh] w-full rounded-xl bg-black shadow-2xl" />
          ) : isAud ? (
            <div className="rounded-xl bg-white p-8 text-center shadow-2xl"><p className="font-medium">{name}</p><audio controls src={url} className="mt-4 w-full" /></div>
          ) : isPdf ? (
            <iframe src={url} title={name} className="h-[80vh] w-full rounded-xl bg-white shadow-2xl" />
          ) : (
            <div className="rounded-xl bg-white p-8 text-center shadow-2xl">
              <p className="font-medium">{name}</p>
              <p className="font-mono text-xs text-[#5f6368]">{mime}</p>
              <p className="mt-2 text-sm text-[#5f6368]">Preview not available — download to view full file like Drive.</p>
              <a href={url} download className="mt-4 inline-flex rounded-full bg-[#1a73e8] px-6 py-2.5 text-sm font-medium text-white">Download</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
