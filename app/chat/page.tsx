import { AppShell } from "@/components/AppShell";
import { ChatManager } from "@/components/chat/ChatManager";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const user = await requireActiveSession();
  const { c } = await searchParams;
  return (
    <AppShell
      user={{ id: user.id, email: user.email, role: user.role, displayName: user.displayName, avatarDriveId: user.avatarDriveId }}
      active="/chat"
      fullBleed
    >
      <ChatManager currentUser={{ id: user.id, email: user.email, displayName: user.displayName }} initialConversationId={c ?? null} />
    </AppShell>
  );
}
