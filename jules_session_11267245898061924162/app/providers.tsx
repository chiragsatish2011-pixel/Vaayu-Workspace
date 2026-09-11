"use client";

import { SessionProvider } from "next-auth/react";
import { UploadProvider } from "@/components/UploadManager";
import { WorkspaceUnreadProvider } from "@/components/WorkspaceUnreadProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        {/* Global upload tracking + bottom-right toast: mounted once here so
            uploads keep running and stay visible across every route. */}
        <UploadProvider>
          <WorkspaceUnreadProvider>{children}</WorkspaceUnreadProvider>
        </UploadProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
