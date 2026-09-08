import Link from "next/link";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { Reveal } from "@/components/Reveal";
import { UserAvatar } from "@/components/UserAvatar";
import { UserRowActions } from "@/components/UserRowActions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";

export default async function AdminPage() {
  const user = await requireAdmin();

  const isDriveConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  );

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      displayName: users.displayName,
      avatarDriveId: users.avatarDriveId,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return (
    <AppShell
      user={{
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        avatarDriveId: user.avatarDriveId,
      }}
      active="/admin"
    >
      <section className="pt-10 sm:pt-14">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
              Admin · team access
            </p>
            <h1
              className="mt-3 max-w-2xl animate-fade-up font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl"
              style={{ animationDelay: "90ms" }}
            >
              Manage accounts.
            </h1>
          </div>
          <Link
            href="/admin/drive-setup"
            className="animate-fade-up inline-flex items-center gap-2.5 rounded-2xl border border-hairline bg-canvas px-5 py-3.5 text-xs font-mono uppercase tracking-wider text-ink shadow-sm hover:bg-fog transition-colors"
          >
            <span>Google Drive Storage</span>
            <Badge tone={isDriveConfigured ? "live" : "phase"}>
              {isDriveConfigured ? "Configured" : "Setup Required"}
            </Badge>
          </Link>
        </div>
        <p
          className="mt-4 max-w-xl animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Admins create accounts, can reset any password, and remove
          accounts. Teammates can also update their own display name, avatar,
          and password in Settings — passwords are always bcrypt-hashed and
          never shown again.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Reveal className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
            <h2 className="font-display text-xl font-bold tracking-tight">
              New account
            </h2>
            <div className="mt-5">
              <CreateAccountForm />
            </div>
          </Reveal>

          <Reveal
            delay={120}
            className="overflow-hidden rounded-2xl border border-hairline bg-canvas"
          >
            <h2 className="border-b border-hairline-soft bg-fog px-6 py-4 font-display text-xl font-bold tracking-tight">
              Team ({allUsers.length})
            </h2>
            <ul className="divide-y divide-hairline-soft">
              {allUsers.map((u) => {
                const primary = (u.displayName && u.displayName.trim()) || u.email;
                const secondary = u.email;
                return (
                  <li key={u.id} className="flex items-start gap-3 px-6 py-3.5">
                    <UserAvatar displayName={u.displayName} email={u.email} avatarDriveId={u.avatarDriveId} size={36} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">
                        {primary}
                        {u.email === user.email && (
                          <span className="ml-2 text-xs font-normal text-stone">(you)</span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-xs text-steel">{secondary}</span>
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-steel">
                        {u.role}
                        {" · "}
                        {new Date(u.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="mt-1 block">
                        <Badge tone={u.role === "admin" ? "phase" : "live"}>{u.role}</Badge>
                      </span>
                    </span>
                    <UserRowActions id={u.id} email={u.email} isSelf={u.email === user.email} />
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </div>
      </section>
    </AppShell>
  );
}
