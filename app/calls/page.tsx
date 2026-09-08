import { AppShell } from "@/components/AppShell";
import { CallsHub } from "@/components/calls/CallsHub";
import { requireActiveSession } from "@/lib/session";
import { getDisplayName } from "@/lib/userColor";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
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
      active="/calls"
    >
      <section className="pt-10 sm:pt-14 pb-16">
        <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">Calls</p>
        <h1 className="mt-3 max-w-2xl animate-fade-up font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl" style={{ animationDelay: "90ms" }}>
          Calls.
        </h1>
        <p className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel" style={{ animationDelay: "160ms" }}>
          One click, face to face — now live. Start a <span className="font-semibold text-ink">Voice</span> or <span className="font-semibold text-ink">Video</span> call from here, or contextually from any project or checkpoint. Both support low-latency screen sharing.
        </p>

        <div className="mt-8">
          <CallsHub displayName={getDisplayName(user.displayName, user.email)} userId={user.id} userRole={user.role} />
        </div>
      </section>
    </AppShell>
  );
}
