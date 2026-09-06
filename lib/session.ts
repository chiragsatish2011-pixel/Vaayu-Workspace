import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Server-side route guards (SERVER ONLY — uses next/headers + redirect).
 *
 * Every protected page calls one of these instead of raw getServerSession,
 * so the mandatory-password rule is enforced in one place with zero drift:
 *
 * - requireActiveSession(): signed in AND password fresh. Otherwise →
 *   /signin (no session / account gone) or /set-password (must change).
 * - requireAdmin(): requireActiveSession() + role === "admin", else → /.
 *
 * The `must_change_password` flag is re-read from the database on every
 * call, so flipping it takes effect immediately — no stale-JWT problem.
 */

export interface ActiveUser {
  id: string;
  email: string;
  role: "admin" | "member";
}

export async function requireActiveSession(): Promise<ActiveUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/signin");

  let rows;
  try {
    rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
  } catch (err) {
    console.error("[session] failed to load user for guard:", err);
    redirect("/signin");
  }

  const user = rows[0];
  if (!user) redirect("/signin");
  if (user.mustChangePassword) redirect("/set-password");
  return { id: user.id, email: user.email, role: user.role };
}

export async function requireAdmin(): Promise<ActiveUser> {
  const user = await requireActiveSession();
  if (user.role !== "admin") redirect("/");
  return user;
}
