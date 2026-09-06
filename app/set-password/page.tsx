import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordForm } from "@/components/PasswordForm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Mandatory first-login page. Flagged users land here from every guard
 * and cannot reach anything else until they set their own password.
 * (Deliberately NOT behind requireActiveSession — that would loop.)
 *
 * Per-user page — always render per request, never prerender at build time.
 */
export const dynamic = "force-dynamic";
export default async function SetPasswordPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/signin");

  const rows = await db
    .select({ mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!rows[0]) redirect("/signin");
  // Nothing to do — password already fresh.
  if (!rows[0].mustChangePassword) redirect("/");

  return (
    <AuthLayout
      eyebrow="First sign-in"
      title="Set your password."
      subtitle="Your admin created this account with a temporary password. Pick your own to enter the workspace."
      footer={
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone">
          One step — then you&apos;re in
        </span>
      }
    >
      <PasswordForm email={session.user.email ?? ""} mandatory />
    </AuthLayout>
  );
}
