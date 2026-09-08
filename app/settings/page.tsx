import { AppShell } from "@/components/AppShell";
import { WinSettings } from "@/components/settings/WinSettings";
import { requireActiveSession } from "@/lib/session";

// Protected, per-user page — always render per request, never prerender
// at build time (it reads the session on every load).
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireActiveSession();

  return (
    <AppShell
      user={{
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        avatarDriveId: user.avatarDriveId,
      }}
      active="/settings"
      fullBleed
    >
      <WinSettings
        user={{
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.displayName,
          avatarDriveId: user.avatarDriveId,
          department: user.department,
          jobTitle: user.jobTitle,
        }}
      />
    </AppShell>
  );
}
