import { AppShell } from "@/components/AppShell";
import { Reveal } from "@/components/Reveal";
import { requireActiveSession } from "@/lib/session";

// Protected, per-user page — always render per request, never prerender
// at build time (it reads the session on every load).
export const dynamic = "force-dynamic";

/**
 * Account settings — read-only profile summary. There is deliberately NO
 * password UI here: only admins control credentials (see /admin).
 */
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
            Role and password changes happen through your admin — contact
            them if you need anything updated on your account.
          </p>
        </Reveal>
      </section>
    </AppShell>
  );
}
