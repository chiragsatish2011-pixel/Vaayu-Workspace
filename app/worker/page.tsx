import { AppShell } from "@/components/AppShell";
import { VaayuWorkerClient } from "@/components/VaayuWorkerClient";
import { requireActiveSession } from "@/lib/session";

export default async function WorkerPage() {
  const user = await requireActiveSession();

  return (
    <AppShell active="/worker" user={{ email: user.email, role: user.role }}>
      <VaayuWorkerClient user={user} />
    </AppShell>
  );
}
