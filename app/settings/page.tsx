import { AppShell } from "@/components/AppShell";
import { ProfileNameForm } from "@/components/ProfileNameForm";
import { Reveal } from "@/components/Reveal";
import { requireActiveSession } from "@/lib/session";

// Protected, per-user page — always render per request, never prerender
// at build time (it reads the session on every load).
export const dynamic = "force-dynamic";

/**
 * Account settings — user profile where users can set their own display name.
 * Email and password changes can only be performed by admins.
 */
export default async function SettingsPage() {
  const user = await requireActiveSession();
  const displayName = user.name?.trim() || null;
  const initial = ((displayName?.[0] || user.email?.[0]) ?? "?").toUpperCase();

  return (
    <AppShell
      user={{ email: user.email, role: user.role, name: user.name }}
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
          Your account.
        </h1>

        <Reveal className="mt-8 rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ink font-display text-lg font-bold text-white">
              {initial}
            </span>
            <div className="leading-tight">
              <h2 className="text-xl font-bold text-ink">
                {displayName ?? "No name set"}
              </h2>
              <p className="mt-0.5 text-sm text-steel">{user.email}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
                {user.role}
              </p>
            </div>
          </div>

          <div className="mt-6 border-t border-hairline-soft pt-6">
            <ProfileNameForm initialName={user.name} />
          </div>

          <p className="mt-6 text-xs text-steel">
            Email and password changes can only be updated by your administrator. Contact an admin if you need your email or password modified.
          </p>
        </Reveal>
      </section>
    </AppShell>
  );
}
