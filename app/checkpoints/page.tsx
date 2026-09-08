import { inArray } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { CheckpointsList } from "@/components/CheckpointsList";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCheckpoints } from "@/lib/checkpoints-store";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * /checkpoints — timeline backed by the "Checkpoints" Google Sheet
 * (lib/checkpoints-store.ts). One sheet read per page load; the client
 * only calls the API for create/update/delete. Auth stays on Neon.
 * Avatar/profile wiring: sheet stores author snapshot (display_name) but
 * NOT avatarDriveId — we enrich every entry from Neon users table so the
 * profile pic system (Settings → Google Drive) actually shows in the Timeline,
 * and initials/color are deterministic per user (email hash + current displayName).
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
    displayName: string | null;
    avatarDriveId?: string | null;
    contentJson?: string | null;
  }> = [];
  let notice: string | null = null;

  try {
    const raw = await getCheckpoints();
    // Enrich from Neon: canonical displayName + avatarDriveId per userId.
    // This wires the profile pic system into the Timeline and ensures
    // initials (C vs CS) are consistent per user (same guy never shows
    // two different initials) — snapshot displayName in Sheet is stale if
    // user later updates profile.
    try {
      const ids = [...new Set(raw.map((r) => r.userId).filter(Boolean))];
      if (ids.length > 0) {
        const userRows = await db
          .select({ id: users.id, displayName: users.displayName, avatarDriveId: users.avatarDriveId, email: users.email })
          .from(users)
          .where(inArray(users.id, ids));
        const byId = new Map(userRows.map((u) => [u.id, u]));
        initialCheckpoints = raw.map((r) => {
          const u = byId.get(r.userId);
          return {
            ...r,
            // Prefer canonical current displayName/avatar from users table; fall back to sheet snapshot
            displayName: u?.displayName ?? r.displayName,
            avatarDriveId: u?.avatarDriveId ?? null,
            // keep email/role from sheet but ensure email canonical if available
            userEmail: u?.email ?? r.userEmail,
          };
        });
      } else {
        initialCheckpoints = raw;
      }
    } catch (enrichErr) {
      console.warn("[CheckpointsPage] enrich from users failed, using sheet snapshot:", enrichErr);
      initialCheckpoints = raw;
    }
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
    <AppShell
      user={{
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        avatarDriveId: user.avatarDriveId,
      }}
      active="/checkpoints"
    >
      <CheckpointsList initialItems={initialCheckpoints} currentUser={{ id: user.id, role: user.role }} notice={notice} />
    </AppShell>
  );
}
