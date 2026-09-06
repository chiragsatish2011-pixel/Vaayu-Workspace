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
  return { id: user.id, email: user.email, role: user.role };
}

export async function requireAdmin(): Promise<ActiveUser> {
  const user = await requireActiveSession();
  if (user.role !== "admin") redirect("/");
  return user;
}
