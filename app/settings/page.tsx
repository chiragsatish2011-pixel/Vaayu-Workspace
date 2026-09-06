import { AppShell } from "@/components/AppShell";
import { PasswordForm } from "@/components/PasswordForm";
import { Reveal } from "@/components/Reveal";
import { requireActiveSession } from "@/lib/session";

// Protected, per-user page — always render per request, never prerender
// at build time (it reads the session on every load).
export const dynamic = "force-dynamic";

/** Account settings — profile summary + voluntary password change. */
export default async function SettingsPage() {
  const user = await requireActiveSession();

  return (
    <AppShell user={{ email: user.email, role: user.role }} active="/settings">
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
              {(user.email[0] ?? "?").toUpperCase()}
            </span>
            <div className="leading-tight">
              <p className="font-medium">{user.email}</p>
              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-steel">
                {user.role}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-steel">
            Role changes happen through your admin — everything else about
            sign-in lives below.
          </p>
        </Reveal>

        <Reveal
          delay={120}
          className="mt-5 rounded-2xl border border-hairline bg-canvas p-6 sm:p-8"
        >
          <h2 className="font-display text-xl font-bold tracking-tight">
            Change password
          </h2>
          <p className="mt-1 text-sm text-steel">
            You&apos;ll need your current password to set a new one.
          </p>
          <div className="mt-5">
            <PasswordForm email={user.email} />
          </div>
        </Reveal>
      </section>
    </AppShell>
  );
}
