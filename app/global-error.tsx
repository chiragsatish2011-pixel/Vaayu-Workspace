"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-white antialiased">
        <div className="grid min-h-screen place-items-center bg-[#0a0a0a] px-6 py-16">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 0 01.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">This page couldn’t load</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/70">Reload to try again, or go back.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) window.history.back();
                  else window.location.assign("/");
                }}
                className="rounded-full border border-white/20 bg-transparent px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
