import { desc } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { Reveal } from "@/components/Reveal";
import { UserRowActions } from "@/components/UserRowActions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";

/**
 * Admin-only page: full control over all credentials. Admins create
 * accounts, change any user's password, and delete accounts — users have
 * no self-service password UI anywhere in the workspace.
 */
export default async function AdminPage() {
  const user = await requireAdmin();

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return (
    <AppShell user={{ email: user.email, role: user.role }} active="/admin">
      <section className="pt-10 sm:pt-14">
        <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
          Admin · team access
        </p>
        <h1
          className="mt-3 max-w-2xl animate-fade-up font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          Manage accounts.
        </h1>
        <p
          className="mt-4 max-w-xl animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Only admins control credentials. Create accounts with a password
          you choose, change any teammate&apos;s password anytime, or remove
          accounts — share passwords privately, they&apos;re stored hashed
          and never shown again.
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
              {allUsers.map((u) => (
                <li
                  key={u.id}
                  className="flex items-start gap-3 px-6 py-3.5"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white">
                    {(u.email[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">
                      {u.email}
                      {u.email === user.email && (
                        <span className="ml-2 text-xs font-normal text-stone">(you)</span>
                      )}
                    </span>
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
                      <Badge tone={u.role === "admin" ? "phase" : "live"}>
                        {u.role}
                      </Badge>
                    </span>
                  </span>
                  <UserRowActions
                    id={u.id}
                    email={u.email}
                    isSelf={u.email === user.email}
                  />
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>
    </AppShell>
  );
}
