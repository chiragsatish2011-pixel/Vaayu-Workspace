import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Server-side route guards (SERVER ONLY — uses next/headers + redirect).
 *
 * Every protected page calls one of these instead of raw getServerSession:
 *
 * - requireActiveSession(): signed in AND account still exists.
 *   Otherwise → /signin. Users go straight from login to the dashboard —
 *   there is no password step: only admins control credentials (/admin).
 * - requireAdmin(): requireActiveSession() + role === "admin", else → /.
 */

export interface ActiveUser {
  id: string;
  email: string;
  role: "admin" | "member";
  displayName?: string | null;
  avatarDriveId?: string | null;
  hasCompletedOnboarding?: boolean;
}

/**
 * Race a promise against a timeout. Used by the guards so a hung database
 * fails closed (redirect to /signin) instead of hanging the navigation
 * forever with no feedback.
 */
function withGuardTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`guard DB read timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function requireActiveSession(): Promise<ActiveUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/signin");

  let rows:
    | Array<{
        id: string;
        email: string;
        role: "admin" | "member";
        displayName?: string | null;
        avatarDriveId?: string | null;
        hasCompletedOnboarding?: boolean | null;
      }>
    | undefined;
  try {
    rows = (await withGuardTimeout(
      db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          displayName: users.displayName,
          avatarDriveId: users.avatarDriveId,
          hasCompletedOnboarding: users.hasCompletedOnboarding,
        })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1),
      15000
    )) as typeof rows;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("column") && (msg.includes("display_name") || msg.includes("avatar") || msg.includes("has_completed"))) {
      console.warn("[session] fallback to minimal columns — run migration 0004");
      try {
        const fallbackRows = (await withGuardTimeout(
          db
            .select({ id: users.id, email: users.email, role: users.role })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1),
          15000
        )) as unknown as Array<{ id: string; email: string; role: "admin" | "member" }>;
        // Patch missing fields
        rows = fallbackRows.map((r) => ({ ...r, displayName: null, avatarDriveId: null, hasCompletedOnboarding: false })) as typeof rows;
      } catch (innerErr) {
        console.error("[session] fallback also failed:", innerErr);
        redirect("/signin");
      }
    } else {
      console.error("[session] failed to load user for guard:", err);
      redirect("/signin");
    }
  }

  const user = rows?.[0];
  if (!user) redirect("/signin");
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: (user as { displayName?: string | null }).displayName ?? null,
    avatarDriveId: (user as { avatarDriveId?: string | null }).avatarDriveId ?? null,
    hasCompletedOnboarding: Boolean((user as { hasCompletedOnboarding?: boolean | null }).hasCompletedOnboarding),
  };
}

export async function requireAdmin(): Promise<ActiveUser> {
  const user = await requireActiveSession();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * API-route session helpers (SERVER ONLY). Unlike the page guards above,
 * these return `null` instead of redirecting, so routes can answer 401/403
 * JSON. Always re-reads the user row — deleted accounts lose access
 * immediately, even with a live JWT.
 */
export async function requireApiSession(): Promise<ActiveUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  try {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        displayName: users.displayName,
        avatarDriveId: users.avatarDriveId,
        hasCompletedOnboarding: users.hasCompletedOnboarding,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const user = rows[0];
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName ?? null,
      avatarDriveId: user.avatarDriveId ?? null,
      hasCompletedOnboarding: Boolean(user.hasCompletedOnboarding),
    };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("column") && (msg.includes("display_name") || msg.includes("avatar") || msg.includes("has_completed"))) {
      console.warn("[session] api fallback to minimal columns — run migration 0004");
      try {
        const rows = await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.id, session.user.id))
          .limit(1);
        const user = rows[0] as unknown as { id: string; email: string; role: "admin" | "member" };
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: null,
          avatarDriveId: null,
          hasCompletedOnboarding: false,
        };
      } catch {
        return null;
      }
    }
    console.error("[session] api guard DB error:", err);
    return null;
  }
}

export async function requireApiAdmin(): Promise<ActiveUser | null> {
  const user = await requireApiSession();
  if (!user || user.role !== "admin") return null;
  return user;
}
