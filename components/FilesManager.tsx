"use client";

import { useCallback, useEffect, useState } from "react";
import { FileBrowser } from "@/components/FileBrowser";
import { FilesUploader } from "@/components/FilesUploader";

/**
 * Team Files manager — root folder resolution + upload staging + the
 * shared file browser. The browser root is the SAME locked team folder
 * Projects publishing uses (resolved server-side via /api/drive/root, so
 * the env var never reaches the client). Uploads, downloads, zips and
 * trash all reuse the exact pipelines built for Projects — this component
 * only wires them together.
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
    <div className="space-y-6">
      <FilesUploader onUploaded={handleUploaded} />
      <FileBrowser
        projectDriveId={root.id}
        projectName={root.name}
        contextNoun="folder"
        emptyText="No files in the team folder yet — upload above to get started."
        refreshKey={refreshKey}
      />
    </div>
  );
}
