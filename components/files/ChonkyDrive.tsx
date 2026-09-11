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
  FileHelper,
  // @ts-ignore
} from "chonky2";
import type { FileData, FileArray, ChonkyActionUnion } from "chonky2";
import { formatBytes } from "@/components/UploadProgressBar";
import { useUploads } from "@/components/UploadManager";
import { useFolderUpload } from "@/components/useFolderUpload";
import { collectFilesFromInput, collectFilesFromDrop, pickedBatchBytes, type PickedUploadFile } from "@/components/folderWalk";

// Helpers reused from FileBrowser (lightweight copy to avoid import cycles)
function buildTreeForChonky(files: any[], rootName: string, rootId: string) {
  type Node = { id: string; name: string; relativePath: string; isFolder: boolean; mimeType: string; size?: string; thumbnailLink?: string; children: Map<string, any>; file?: any };
  const root: Node = { id: rootId, name: rootName, relativePath: "", isFolder: true, mimeType: "application/vnd.google-apps.folder", children: new Map() };
  for (const f of files) {
    if (f.relativePath === "" || f.relativePath === rootName) continue;
    const parts = f.relativePath.split("/").filter(Boolean);
    let cur: Node = root;
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
          children: new Map(),
          file: isLast ? f : undefined,
        });
      }
      cur = cur.children.get(part)!;
      if (isLast) cur.file = f;
    }
  }
  return root as any;
}

function getCurrentNode(root: any, gridPath: string[]) {
  let node = root;
  for (const seg of gridPath) {
    const next = Array.from(node.children.values()).find((c: any) => c.isFolder && c.name === seg);
    if (!next) break;
    node = next;
  }
  return node;
}

function isImage(mime: string, name: string) {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return true;
  const ext = name.toLowerCase().split(".").pop() || "";
  return ["png","jpg","jpeg","gif","webp","svg","bmp","ico","tiff"].includes(ext);
}

export function ChonkyDrive({ rootId, rootName, refreshKey, onUploaded }: { rootId: string; rootName: string; refreshKey?: number; onUploaded?: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gridPath, setGridPath] = useState<string[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { track } = useUploads();
  const { runFolderUpload } = useFolderUpload();

  const load = useCallback(async (fresh?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const useFresh = Boolean(fresh) || (refreshKey ?? 0) > 0;
      const url = `/api/drive/browse?id=${encodeURIComponent(rootId)}${useFresh ? "&fresh=1" : ""}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "Could not load folder.");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [rootId, refreshKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { folderInputRef.current?.setAttribute("webkitdirectory", ""); }, []);
  useEffect(() => { markPanelSeen("files"); }, []);

  const tree = useMemo(() => {
    if (!data) return null;
    return buildTreeForChonky(data.files, data.root.name, data.root.id);
  }, [data]);

  const currentNode = useMemo(() => {
    if (!tree) return null;
    return getCurrentNode(tree, gridPath);
  }, [tree, gridPath]);

  const folderChain = useMemo(() => {
    if (!tree) return [{ id: rootId, name: rootName, isDir: true }];
    const chain: FileData[] = [{ id: tree.id, name: tree.name, isDir: true }];
    let cur = tree;
    for (const seg of gridPath) {
      const next = Array.from(cur.children.values()).find((c: any) => c.isFolder && c.name === seg);
      if (!next) break;
      chain.push({ id: next.id, name: next.name, isDir: true });
      cur = next;
    }
    return chain;
  }, [tree, gridPath, rootId, rootName]);

  const files: FileArray = useMemo(() => {
    if (!currentNode) return [];
    const out: FileData[] = [];
    for (const child of Array.from(currentNode.children.values()) as any[]) {
      const name = String(child.name);
      const lower = name.toLowerCase();
      // Hide internal system folders/files from main Drive view
      if (child.isFolder && (lower === "avatars" || lower === "voice notes")) continue;
      if (!child.isFolder && lower.startsWith("avatar-")) continue;
      const isDir = Boolean(child.isFolder);
      const mime = child.mimeType || (isDir ? "application/vnd.google-apps.folder" : "application/octet-stream");
      const size = child.size ? Number(child.size) : undefined;
      const modDate = child.file?.modifiedTime ? new Date(child.file.modifiedTime) : undefined;
      const thumb = child.thumbnailLink ? String(child.thumbnailLink).replace(/=s\d+$/, "=s400") : undefined;
      out.push({
        id: String(child.id),
        name,
        isDir,
        size,
        modDate,
        thumbnailUrl: !isDir ? thumb : undefined,
        ext: isDir ? undefined : "." + name.split(".").pop()!.toLowerCase(),
        // keep raw for handlers
        driveFile: child.file ?? child,
        realId: child.file?.id ?? (String(child.id).startsWith("folder-") ? null : String(child.id)),
      } as any);
    }
    // sort folders first like Drive
    out.sort((a, b) => {
      if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    return out;
  }, [currentNode]);

  // map chonky file id -> tree node for handlers
  const idToNode = useMemo(() => {
    const m = new Map<string, any>();
    if (!currentNode) return m;
    for (const child of Array.from(currentNode.children.values()) as any[]) {
      m.set(String(child.id), child);
    }
    return m;
  }, [currentNode]);

  const startUpload = useCallback((picked: PickedUploadFile[]) => {
    if (picked.length === 0) return;
    const total = pickedBatchBytes(picked);
    const label = picked.length === 1 ? `Upload "${picked[0]!.file.name}"` : `Upload ${picked.length} files`;
    const { finished } = track(label, total, async (report) => {
      const ref = { value: 0 };
      const tree = await runFolderUpload(picked, report, ref);
      if (tree.succeeded === 0) throw new Error(tree.failed[0]?.error || "Upload failed");
    });
    finished.then(() => { if (onUploaded) onUploaded(); else void load(true); }, () => {});
  }, [track, runFolderUpload, onUploaded, load]);

  const handleFileAction = useCallback(async (data: any) => {
    const { id, payload } = data as { id: string; payload: any };
    // Navigation
    if (id === ChonkyActions.OpenFiles.id) {
      const files = payload.files as FileData[];
      const file = files?.[0];
      if (!file) return;
      if (file.isDir) {
        // navigate into folder
        setGridPath((prev) => [...prev, String(file.name)]);
        return;
      }
      // preview file
      const node = idToNode.get(String(file.id));
      if (node) setPreview(node);
      else setPreview({ name: String(file.name), mimeType: "application/octet-stream", size: (file as any).size, id: String(file.id), file: (file as any).driveFile } as any);
      return;
    }
    if (id === ChonkyActions.OpenParentFolder.id) {
      setGridPath((prev) => prev.slice(0, -1));
      return;
    }
    if (id === "create_folder") {
      const n = window.prompt("New folder name");
      if (!n || !n.trim()) return;
      const name: string = n.trim();
      // parent is currentNode
      const parentId = (currentNode as any)?.file?.id ?? (String((currentNode as any)?.id).startsWith("folder-") ? rootId : String((currentNode as any)?.id || rootId));
      // resolve real parent: if currentNode is synthetic folder-..., use root
      const realParent = String(parentId).startsWith("folder-") ? rootId : parentId;
      try {
        const res = await fetch("/api/drive/create-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: realParent, name }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Create failed");
        await load(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Create failed");
      }
      return;
    }
    if (id === ChonkyActions.DeleteFiles.id) {
      const sel = payload.files as FileData[];
      if (!sel || sel.length === 0) return;
      const ids: string[] = sel.map((f: any) => String(f.realId || f.id)).filter((x: string) => x && !x.startsWith("folder-"));
      if (ids.length === 0) return;
      if (!window.confirm(`Move ${ids.length} item(s) to trash? You can restore from Google Drive Trash.`)) return;
      try {
        const res = await fetch("/api/drive/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Trash failed");
        await load(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Trash failed");
      }
      return;
    }
    if (id === ChonkyActions.DownloadFiles.id) {
      const sel = payload.files as FileData[];
      const list = sel && sel.length ? sel : [];
      if (list.length === 0) return;
      if (list.length === 1) {
        const f: any = list[0];
        const real = String(f.realId || f.id);
        if (real.startsWith("folder-")) {
          // folder zip
          const node = idToNode.get(String(f.id));
          const name = String(f.name);
          const folderId = real;
          try {
            const res = await fetch("/api/drive/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: folderId, name }) });
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Zip failed");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `${name}.zip`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          } catch (e) { alert(e instanceof Error ? e.message : "Download failed"); }
          return;
        }
        const a = document.createElement("a");
        a.href = `/api/drive/download?id=${encodeURIComponent(String(f.realId || f.id))}`;
        a.download = String(f.name);
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        const ids = list.map((f: any) => String(f.realId || f.id)).filter((x: string) => !x.startsWith("folder-"));
        if (ids.length === 0) return;
        try {
          const res = await fetch("/api/drive/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, name: "selection" }) });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Zip failed");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "selection.zip"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        } catch (e) { alert(e instanceof Error ? e.message : "Zip failed"); }
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
      if (destId.startsWith("folder-")) return;
      const moveIds = filesToMove.map((f: any) => String(f.realId || f.id)).filter((x: string) => !x.startsWith("folder-"));
      if (moveIds.length === 0) return;
      try {
        for (const mid of moveIds) {
          const res = await fetch("/api/drive/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mid, destinationParentId: destId }) });
          const j = await res.json().catch(() => null);
          if (!res.ok) throw new Error(j?.error || "Move failed");
        }
        await load(true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Move failed");
      }
      return;
    }
  }, [idToNode, currentNode, rootId, load]);

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

  const chonkyFiles = useMemo(() => files, [files]);

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

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-white p-12 text-center dark:bg-[#131316]">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => void load()} className="mt-3 rounded-full bg-[#0a0a0a] px-5 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Retry</button>
      </div>
    );
  }

  if (loading && !data) {
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
            files={chonkyFiles as any}
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
          <span>{data ? `${data.fileCount} files · ${formatBytes(data.totalBytes)}` : ""}</span>
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
