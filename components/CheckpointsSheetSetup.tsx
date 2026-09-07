"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";

/**
 * One-click Checkpoints sheet setup + live health (Admin → Drive setup).
 *
 * Shows exactly what the app sees (spreadsheet resolves? tab? headers?)
 * with clear success/failure feedback — a broken setup is visible HERE
 * immediately instead of surfacing later as a 404 deep in checkpoint
 * creation. The create/repair call is idempotent: a healthy sheet is
 * returned untouched, never duplicated.
 */

interface Health {
  configured: boolean;
  spreadsheetId: string | null;
  resolves: boolean;
  title: string | null;
  url: string | null;
  tabExists: boolean;
  headersMatch: boolean;
  ready: boolean;
  error: string | null;
  envVar: string;
}

interface EnsureResult {
  spreadsheetId: string;
  url: string;
  created: boolean;
  reusedExisting: boolean;
  repairedTab: boolean;
  repairedHeaders: boolean;
  needsEnvSave: boolean;
  envVar: string;
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline-soft bg-fog px-4 py-2.5">
      <span className="text-xs font-medium text-ink">{label}</span>
      <Badge tone={ok ? "live" : "phase"}>{ok ? "OK" : "Missing"}</Badge>
    </div>
  );
}

/** Fetch sheet health (pure fetch — no state). Throws on transport failure. */
async function loadHealth(): Promise<Health> {
  const res = await fetch("/api/admin/checkpoints-sheet", { cache: "no-store" });
  const data = (await res.json().catch(() => null)) as Health | null;
  if (!res.ok || !data) {
    throw new Error("Could not check sheet status.");
  }
  return data;
}

export function CheckpointsSheetSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<EnsureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await loadHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Mount fetch: setters run only in async continuations (never
    // synchronously in the effect body), with unmount cancellation.
    loadHealth().then(
      (data) => {
        if (cancelled) return;
        setHealth(data);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Status check failed.");
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnsure = async () => {
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/checkpoints-sheet", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | (EnsureResult & { error?: unknown })
        | null;
      if (!res.ok || !data || typeof data.spreadsheetId !== "string") {
        throw new Error(
          data && typeof data.error === "string" && data.error
            ? data.error
            : "Automatic setup failed — follow the manual steps below instead."
        );
      }
      setResult(data);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Automatic setup failed."
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      {loading && (
        <p className="mt-4 text-sm text-steel">Checking sheet status…</p>
      )}

      {!loading && health && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              {health.ready
                ? "Checkpoints storage is reachable."
                : "Checkpoints storage needs setup."}
            </p>
            <Badge tone={health.ready ? "live" : "phase"}>
              {health.ready ? "Ready" : "Needs setup"}
            </Badge>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <CheckRow label="Spreadsheet resolves" ok={health.resolves} />
            <CheckRow label="“Checkpoints” tab exists" ok={health.tabExists} />
            <CheckRow label="Header row A1:H correct" ok={health.headersMatch} />
          </div>

          {health.title && (
            <p className="mt-3 text-xs text-steel">
              Sheet: <span className="font-semibold text-ink">{health.title}</span>{" "}
              {health.url && (
                <a
                  href={health.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:opacity-80"
                >
                  Open in Google Sheets →
                </a>
              )}
            </p>
          )}

          {health.error && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
              {health.error}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3.5 text-xs leading-relaxed text-green-900">
              {result.created
                ? "Created a brand-new Checkpoints spreadsheet. "
                : result.reusedExisting
                  ? "Found your existing Checkpoints spreadsheet and reused it (no duplicate created). "
                  : result.repairedTab || result.repairedHeaders
                    ? "Repaired the existing spreadsheet (tab/headers). "
                    : "The sheet was already healthy — nothing changed. "}
              {result.needsEnvSave && (
                <>
                  Save this ID as{" "}
                  <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono">
                    {result.envVar}
                  </code>{" "}
                  in <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono">.env.local</code> and in
                  Vercel env vars, then redeploy:{" "}
                  <code className="block mt-1.5 break-all rounded bg-white/70 px-2 py-1.5 font-mono">
                    {result.spreadsheetId}
                  </code>
                </>
              )}
            </div>
          )}

          {!health.ready && (
            <button
              type="button"
              onClick={handleEnsure}
              disabled={working}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {working
                ? "Setting up…"
                : health.configured
                  ? "Repair automatically"
                  : "Create sheet automatically"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
