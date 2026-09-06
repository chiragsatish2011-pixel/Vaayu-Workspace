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

  let rows;
  try {
    rows = await withGuardTimeout(
      db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1),
      15000
    );
  } catch (err) {
    console.error("[session] failed to load user for guard:", err);
    redirect("/signin");
  }

  const user = rows[0];
  if (!user) redirect("/signin");
  return { id: user.id, email: user.email, role: user.role };
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
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const user = rows[0];
    if (!user) return null;
    return { id: user.id, email: user.email, role: user.role };
  } catch (err) {
    console.error("[session] api guard DB error:", err);
    return null;
  }
}

export async function requireApiAdmin(): Promise<ActiveUser | null> {
  const user = await requireApiSession();
  if (!user || user.role !== "admin") return null;
  return user;
}
