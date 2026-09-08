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
    >
      <section className="pt-6 sm:pt-8">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Settings</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Settings</h1>
        <p className="mt-1 text-sm text-steel">Organised like your system settings — pick a category on the left.</p>
        <div className="mt-6">
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
        </div>
      </section>
    </AppShell>
  );
}
