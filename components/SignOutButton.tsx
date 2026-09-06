"use client";

import { signOut } from "next-auth/react";
import { LogoutIcon } from "@/components/icons";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/signin" })}
      className="press flex w-full items-center justify-center gap-2 rounded-full border border-ink bg-transparent px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-ink hover:text-white"
    >
      <LogoutIcon className="h-4 w-4" />
      Sign out
    </button>
  );
}
