"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { GlobalSearch } from "@/components/GlobalSearch";
import { SearchIcon } from "@/components/icons";

/**
 * Mobile search — the desktop <GlobalSearch/> lives in a `sm:flex` wrapper,
 * so below 640px there was zero search UI. This renders a header icon
 * (mobile only) that expands a full-width search row under the header.
 */
export function MobileSearch() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the panel on navigation (adjust-during-render, not an effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Search workspace"
        aria-expanded={open}
        className="press grid h-10 w-10 place-items-center rounded-full border border-hairline bg-canvas text-ink sm:hidden"
      >
        <SearchIcon className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-x-0 top-16 z-30 border-b border-hairline-soft bg-canvas/95 px-4 py-2.5 backdrop-blur-md sm:hidden">
          <GlobalSearch />
        </div>
      )}
    </>
  );
}
