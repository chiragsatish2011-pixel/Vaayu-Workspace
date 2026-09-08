import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireActiveSession } from "@/lib/session";

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
          Calls is paused.
        </h1>
        <p className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel" style={{ animationDelay: "160ms" }}>
          Voice and video calls are temporarily disabled across the whole workspace. Everything else — files, projects, chat, checkpoints — keeps working.
        </p>

        <div className="mt-8 animate-fade-up rounded-2xl border border-amber-200 bg-amber-50 p-6" style={{ animationDelay: "220ms" }}>
          <h2 className="font-display text-lg font-bold text-amber-900">Why you see this</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/80">
            We were using <span className="font-semibold">Daily.co</span> to run calls. Daily recently requires a <span className="font-semibold">payment method on file</span> before it lets any room start or join — even on its free tier. Without a card it returns
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-xs">account-missing-payment-method</code>
            and every call shows “Couldn’t join call.” That’s the screen you saw.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-amber-900/80">
            Because the workspace can’t move forward while that bill-wall is up, we’ve <span className="font-semibold">turned Calls off everywhere</span> for now — the “Start Call” buttons in projects and checkpoints are hidden, the call APIs are disabled, and you don’t need to keep <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">DAILY_API_KEY</code> in Vercel. You can safely delete that env var.
          </p>
          <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-900">What happens next</p>
            <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-steel">
              <li>Calls stay hidden until we switch to a free provider that doesn’t need a card (e.g. Jitsi) or re-enable Daily with billing.</li>
              <li>No data was lost — past call history stays in the database but is not shown while Calls is paused.</li>
              <li>If you want calls back, tell us and we’ll wire the free option — no payment needed.</li>
            </ul>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/projects" className="inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-charcoal">
              Go to Projects
            </Link>
            <Link href="/chat" className="inline-flex rounded-full border border-hairline bg-canvas px-5 py-2.5 text-sm font-semibold hover:border-ink">
              Go to Chat
            </Link>
          </div>
        </div>

        <p className="mt-6 text-xs text-stone">You can remove <span className="font-mono">DAILY_API_KEY</span> from Vercel → Environment Variables safely after this deploy. Re-adding it later won’t break anything.</p>
      </section>
    </AppShell>
  );
}
