"use client";

import { SessionProvider } from "next-auth/react";
import { UploadProvider } from "@/components/UploadManager";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Global upload tracking + bottom-right toast: mounted once here so
          uploads keep running and stay visible across every route. */}
      <UploadProvider>{children}</UploadProvider>
    </SessionProvider>
  );
}
