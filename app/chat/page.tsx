import { AppShell } from "@/components/AppShell";
import { ChatManager } from "@/components/chat/ChatManager";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireActiveSession();
  return (
    <AppShell
      user={{ id: user.id, email: user.email, role: user.role, displayName: user.displayName, avatarDriveId: user.avatarDriveId }}
      active="/chat"
    >
      <section className="pt-10 sm:pt-14 pb-16">
        <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">Chat — Team</p>
        <h1 className="mt-3 max-w-2xl animate-fade-up font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl" style={{ animationDelay: "90ms" }}>
          Chat.
        </h1>
        <p className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel" style={{ animationDelay: "160ms" }}>
          Real-time team chat — history persists in Neon Postgres. Use <span className="font-mono text-ink">@</span> mentions soon to link people, projects, files and checkpoints.
        </p>
        <div className="mt-8">
          <ChatManager currentUser={{ id: user.id, email: user.email, displayName: user.displayName }} />
        </div>
      </section>
    </AppShell>
  );
}
