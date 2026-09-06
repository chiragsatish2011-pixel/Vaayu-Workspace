import { desc, eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { CheckpointsList } from "@/components/CheckpointsList";
import { Reveal } from "@/components/Reveal";
import { db } from "@/db";
import { checkpoints, users } from "@/db/schema";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CheckpointsPage() {
  const user = await requireActiveSession();

  let initialCheckpoints: Array<{
    id: string;
    note: string;
    createdAt: string;
    userId: string;
    userEmail: string;
    userRole: "admin" | "member";
  }> = [];

  try {
    const rows = await db
      .select({
        id: checkpoints.id,
        note: checkpoints.note,
        createdAt: checkpoints.createdAt,
        userId: checkpoints.userId,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(checkpoints)
      .innerJoin(users, eq(checkpoints.userId, users.id))
      .orderBy(desc(checkpoints.createdAt));

    initialCheckpoints = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[CheckpointsPage] Error fetching initial checkpoints:", err);
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
          <CheckpointsList initialItems={initialCheckpoints} />
        </Reveal>
      </section>
    </AppShell>
  );
}
