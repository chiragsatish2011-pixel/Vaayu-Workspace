import { AppShell } from "@/components/AppShell";
import { CheckpointsList } from "@/components/CheckpointsList";
import { Reveal } from "@/components/Reveal";
import { getCheckpoints } from "@/lib/checkpoints-store";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * /checkpoints — timeline backed by the "Checkpoints" Google Sheet
 * (lib/checkpoints-store.ts). One sheet read per page load; the client
 * only calls the API for create/update/delete. Auth stays on Neon.
 */
export default async function CheckpointsPage() {
  const user = await requireActiveSession();

  let initialCheckpoints: Array<{
    id: string;
    note: string;
    createdAt: string;
    updatedAt: string;
    userId: string;
    userEmail: string;
    userRole: "admin" | "member";
  }> = [];
  let notice: string | null = null;

  try {
    initialCheckpoints = await getCheckpoints();
  } catch (err) {
    console.error("[CheckpointsPage] Error fetching initial checkpoints:", err);
    if (user.role === "admin") {
      const detail =
        err instanceof Error && err.message
          ? err.message
          : "Unknown storage error.";
      notice = `Checkpoints storage isn't reachable: ${detail} See Admin → Drive setup for the one-time sheet steps.`;
    }
  }

  return (
    <AppShell user={{ email: user.email, role: user.role }} active="/checkpoints">
      <section className="mx-auto max-w-4xl pt-10 sm:pt-14">
        <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
          Team Timeline
        </p>
        <h1
          className="mt-3 animate-fade-up font-display text-4xl font-bold tracking-[-0.02em] sm:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          Checkpoints.
        </h1>
        <p
          className="mt-4 animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Keep the team synced on work completed. Anyone on the team can log timeline updates like design tweaks, landing page polish, or bug fixes.
        </p>

        <Reveal delay={200} className="mt-8">
          <CheckpointsList
            initialItems={initialCheckpoints}
            currentUser={{ id: user.id, role: user.role }}
            notice={notice}
          />
        </Reveal>
      </section>
    </AppShell>
  );
}
