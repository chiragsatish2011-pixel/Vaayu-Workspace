"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Banner on the auth pages when the workspace isn't set up yet —
 * points the owner at /setup instead of failing cryptically.
 */
export function SetupBanner() {
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { reachable?: boolean; tables?: boolean; admin?: boolean } | null) => {
        if (!cancelled && s && (!s.reachable || !s.tables || !s.admin)) {
          setNeeded(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!needed) return null;
  return (
    <p className="animate-fade-in rounded-lg border border-azure-deep/30 bg-azure-soft px-3.5 py-2.5 text-sm text-azure-deep">
      This workspace isn&apos;t set up yet.{" "}
      <Link href="/setup" className="font-semibold underline underline-offset-4">
        Finish setup
      </Link>{" "}
      to create the owner account.
    </p>
  );
}
