"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="grid min-h-[calc(100vh-200px)] place-items-center bg-canvas px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink">This page couldn’t load</h1>
        <p className="mt-2 text-sm leading-relaxed text-steel">Something went wrong on our side. Your data is safe — try reloading, or go back.</p>
        {isDev && error?.message && (
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-fog p-3 text-left font-mono text-xs text-ink whitespace-pre-wrap break-words border border-hairline">
            {error.message}
            {error.digest ? `\nDigest: ${error.digest}` : ""}
          </pre>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-charcoal"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else window.location.assign("/");
            }}
            className="rounded-full border border-hairline bg-canvas px-5 py-2.5 text-sm font-semibold text-ink hover:border-ink"
          >
            Back
          </button>
        </div>
        <p className="mt-4 font-mono text-xs text-stone">
          If this keeps happening, contact your admin or try again in a moment.
        </p>
      </div>
    </div>
  );
}
