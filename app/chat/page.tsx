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
      fullBleed
    >
      <ChatManager currentUser={{ id: user.id, email: user.email, displayName: user.displayName }} />
    </AppShell>
  );
}
