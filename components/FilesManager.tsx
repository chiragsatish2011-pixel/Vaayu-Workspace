"use client";

import { useCallback, useEffect, useState } from "react";
import { FileBrowser } from "@/components/FileBrowser";

/**
 * Team Files manager — Drive-identical file browser.
 *
 * Resolves the SAME locked team folder Projects publishing uses (via
 * /api/drive/root, so the env var never reaches the client). Upload
 * interaction now matches Drive's real pattern: drag-and-drop works
 * directly onto the file list/grid area itself, and the "+ New"
 * primary action offers "New folder" / "File upload" / "Folder upload"
 * as a dropdown — no persistent large drop-zone card sitting above the
 * list (that marketing-card pattern was removed to match Drive).
 * All pipelines (upload, download, zip, trash, rename, move) still
 * reuse the exact code built for Projects.
 */
export function FilesManager() {
  const [root, setRoot] = useState<{ id: string; name: string } | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drive/root", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.id !== "string") {
          throw new Error(
            data?.error || "Could not load the team folder."
          );
        }
        if (!cancelled) {
          setRoot({
            id: data.id,
            name: typeof data.name === "string" ? data.name : "Team Files",
          });
        }
      } catch (err) {
        if (!cancelled) {
          setRootError(
            err instanceof Error ? err.message : "Could not load the team folder."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUploaded = useCallback(() => {
    // Browsing is server-cached briefly; bump past it so new files appear.
    setRefreshKey((k) => k + 1);
  }, []);

  if (rootError) {
    return (
      <div className="rounded-2xl border border-hairline bg-canvas p-6 text-sm text-error">
        {rootError}
      </div>
    );
  }

  if (!root) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-64 rounded-2xl bg-fog" />
        <div className="h-96 rounded-2xl bg-fog" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileBrowser
        projectDriveId={root.id}
        projectName={root.name}
        contextNoun="folder"
        emptyText="No files yet — use New to create a folder or drag files here to upload."
        refreshKey={refreshKey}
        onUploaded={handleUploaded}
        manage
        defaultView="grid"
        variant="drive"
      />
    </div>
  );
}
