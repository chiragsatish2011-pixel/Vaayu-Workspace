import { AppShell } from "@/components/AppShell";
import { FilesManager } from "@/components/FilesManager";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
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
      active="/files"
    >
      <section className="pt-3 sm:pt-4 pb-6">
        <FilesManager />
      </section>
    </AppShell>
  );
}
