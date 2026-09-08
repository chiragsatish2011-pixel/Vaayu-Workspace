import { AppShell } from "@/components/AppShell";
import { Reveal } from "@/components/Reveal";
import { SettingsForm } from "@/components/SettingsForm";
import { UploadPreferenceToggle } from "@/components/UploadPreferenceToggle";
import { requireActiveSession } from "@/lib/session";

// Protected, per-user page — always render per request, never prerender
// at build time (it reads the session on every load).
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireActiveSession();

  return (
    <AppShell
      user={{
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        avatarDriveId: user.avatarDriveId,
      }}
      active="/settings"
    >
      <section className="mx-auto max-w-2xl pt-10 sm:pt-14">
        <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
          Settings
        </p>
        <h1
          className="mt-3 animate-fade-up font-display text-4xl font-bold tracking-[-0.02em] sm:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          Your profile.
        </h1>
        <p className="mt-3 animate-fade-up text-sm text-steel" style={{ animationDelay: "120ms" }}>
          Update your display name, avatar, and password. Your avatar uses the team&apos;s Google Drive — same infra as project uploads.
        </p>

        <Reveal className="mt-8 rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
          <SettingsForm
            initialDisplayName={user.displayName}
            initialEmail={user.email}
            initialAvatarDriveId={user.avatarDriveId}
            initialRole={user.role}
          />
        </Reveal>

        <Reveal
          delay={120}
          className="mt-6 rounded-2xl border border-hairline bg-canvas p-6 sm:p-8"
        >
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Uploads
          </h2>
          <p className="mt-1 text-sm text-steel">
            How publishing and file uploads behave for you on this device.
          </p>
          <div className="mt-5 border-t border-hairline-soft pt-5">
            <UploadPreferenceToggle />
          </div>
        </Reveal>
      </section>
    </AppShell>
  );
}
